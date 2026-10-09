//! rustls-acme's directory cache, kept private to the host user: the directory is 0700 and
//! each of its files 0600, since they hold the account and certificate private keys.
//! `DirCache` overwrites a file in place, so a full disk or a crash mid-write would destroy
//! the copy the host needs to restart. Each store has `DirCache` write into a fresh staging
//! directory instead, then syncs the file and renames it over the cached one, as Caddy does.
use rustls_acme::{AccountCache, CertCache, caches::DirCache};
use std::{
    io,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

const STAGING: &str = ".staging-";

pub struct PrivateDirCache {
    inner: DirCache<PathBuf>,
    directory: PathBuf,
    stores: AtomicU64,
}
impl PrivateDirCache {
    pub fn new(directory: PathBuf) -> io::Result<Self> {
        std::fs::create_dir_all(&directory)?;
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))?;
        clean(&directory)?;
        Ok(Self {
            inner: DirCache::new(directory.clone()),
            directory,
            stores: AtomicU64::new(0),
        })
    }

    fn staging(&self) -> io::Result<PathBuf> {
        let n = self.stores.fetch_add(1, Ordering::Relaxed);
        let path = self.directory.join(format!("{STAGING}{n}"));
        std::fs::create_dir(&path)?;
        Ok(path)
    }

    fn commit(&self, staging: &Path, written: io::Result<()>) -> io::Result<()> {
        let result = written.and_then(|()| {
            for entry in std::fs::read_dir(staging)? {
                let entry = entry?;
                let file = std::fs::File::open(entry.path())?;
                file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
                file.sync_all()?;
                std::fs::rename(entry.path(), self.directory.join(entry.file_name()))?;
            }
            std::fs::File::open(&self.directory)?.sync_all()
        });
        let _ = std::fs::remove_dir_all(staging);
        result
    }
}

/// Removes staging left by a crash and narrows files cached before the host made them 0600.
/// Only files named as `DirCache` names them (`cached_account_*`, `cached_cert_*`) change mode.
fn clean(directory: &Path) -> io::Result<()> {
    for entry in std::fs::read_dir(directory)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if metadata.is_dir() && name.starts_with(STAGING) {
            std::fs::remove_dir_all(entry.path())?;
        } else if metadata.is_file()
            && name.starts_with("cached_")
            && metadata.permissions().mode() & 0o077 != 0
        {
            std::fs::set_permissions(entry.path(), std::fs::Permissions::from_mode(0o600))?;
        }
    }
    Ok(())
}

#[async_trait::async_trait]
impl CertCache for PrivateDirCache {
    type EC = io::Error;
    async fn load_cert(
        &self,
        domains: &[String],
        directory_url: &str,
    ) -> io::Result<Option<Vec<u8>>> {
        self.inner.load_cert(domains, directory_url).await
    }
    async fn store_cert(
        &self,
        domains: &[String],
        directory_url: &str,
        cert: &[u8],
    ) -> io::Result<()> {
        let staging = self.staging()?;
        let written = DirCache::new(staging.clone())
            .store_cert(domains, directory_url, cert)
            .await;
        self.commit(&staging, written)
    }
}

#[async_trait::async_trait]
impl AccountCache for PrivateDirCache {
    type EA = io::Error;
    async fn load_account(
        &self,
        contact: &[String],
        directory_url: &str,
    ) -> io::Result<Option<Vec<u8>>> {
        self.inner.load_account(contact, directory_url).await
    }
    async fn store_account(
        &self,
        contact: &[String],
        directory_url: &str,
        account: &[u8],
    ) -> io::Result<()> {
        let staging = self.staging()?;
        let written = DirCache::new(staging.clone())
            .store_account(contact, directory_url, account)
            .await;
        self.commit(&staging, written)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mode(path: &Path) -> u32 {
        std::fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[tokio::test]
    async fn the_cache_keeps_its_directory_and_files_private() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("acme");
        std::fs::create_dir(&directory).unwrap();
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o755)).unwrap();
        let earlier = directory.join("cached_cert_earlier");
        std::fs::create_dir(directory.join(".staging-0")).unwrap();
        std::fs::write(directory.join(".staging-0/cached_cert_torn"), "").unwrap();
        let other = directory.join("notes.txt");
        for file in [&earlier, &other] {
            std::fs::write(file, "text").unwrap();
            std::fs::set_permissions(file, std::fs::Permissions::from_mode(0o644)).unwrap();
        }

        let cache = PrivateDirCache::new(directory.clone()).unwrap();
        assert_eq!(mode(&directory), 0o700);
        assert_eq!(mode(&earlier), 0o600);
        assert_eq!(
            mode(&other),
            0o644,
            "a file the cache didn't write keeps its mode"
        );
        let url = "https://acme.test/directory";
        cache
            .store_cert(&["snowtime.test".into()], url, b"cert")
            .await
            .unwrap();
        cache
            .store_account(&["mailto:ops@snowtime.test".into()], url, b"account")
            .await
            .unwrap();
        let files: Vec<_> = std::fs::read_dir(&directory)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| *path != other)
            .collect();
        assert_eq!(files.len(), 3, "{files:?}");
        for file in &files {
            assert_eq!(mode(file), 0o600, "{}", file.display());
        }
        assert_eq!(
            cache
                .load_cert(&["snowtime.test".into()], url)
                .await
                .unwrap()
                .as_deref(),
            Some(b"cert".as_slice())
        );
    }

    #[tokio::test]
    async fn a_store_replaces_the_cached_file_instead_of_overwriting_it() {
        let directory = tempfile::tempdir().unwrap();
        let cache = PrivateDirCache::new(directory.path().to_owned()).unwrap();
        let domains = ["snowtime.test".to_owned()];
        let url = "https://acme.test/directory";
        cache.store_cert(&domains, url, b"first").await.unwrap();
        let cached = std::fs::read_dir(directory.path())
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let earlier = directory.path().join("earlier");
        std::fs::hard_link(&cached, &earlier).unwrap();

        cache.store_cert(&domains, url, b"second").await.unwrap();
        assert_eq!(std::fs::read(&earlier).unwrap(), b"first");
        assert_eq!(std::fs::read(&cached).unwrap(), b"second");
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 2);
    }
}
