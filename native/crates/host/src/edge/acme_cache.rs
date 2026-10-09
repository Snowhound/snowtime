//! rustls-acme's directory cache, kept private to the host user: the directory is 0700 and
//! every file in it 0600, since it holds the account and certificate private keys.
//! `DirCache` writes a new file with the process umask; the store then narrows it, while
//! the directory's mode already keeps other users out.
use rustls_acme::{AccountCache, CertCache, caches::DirCache};
use std::{
    io,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
};

pub struct PrivateDirCache {
    inner: DirCache<PathBuf>,
    directory: PathBuf,
}
impl PrivateDirCache {
    pub fn new(directory: PathBuf) -> io::Result<Self> {
        std::fs::create_dir_all(&directory)?;
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))?;
        restrict(&directory)?;
        Ok(Self {
            inner: DirCache::new(directory.clone()),
            directory,
        })
    }
}

fn restrict(directory: &Path) -> io::Result<()> {
    for entry in std::fs::read_dir(directory)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        if metadata.is_file() && metadata.permissions().mode() & 0o077 != 0 {
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
        self.inner.store_cert(domains, directory_url, cert).await?;
        restrict(&self.directory)
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
        self.inner
            .store_account(contact, directory_url, account)
            .await?;
        restrict(&self.directory)
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
        std::fs::write(&earlier, "key").unwrap();
        std::fs::set_permissions(&earlier, std::fs::Permissions::from_mode(0o644)).unwrap();

        let cache = PrivateDirCache::new(directory.clone()).unwrap();
        assert_eq!(mode(&directory), 0o700);
        assert_eq!(mode(&earlier), 0o600);
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
            .collect();
        assert_eq!(files.len(), 3);
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
}
