//! The public directory's paths, listed once at startup. A request for any other path goes
//! to pages without a file call, and a precompressed variant serves only beside its base
//! file. The files themselves are still read from disk when served.
use std::{
    collections::HashSet,
    io,
    path::{Component, Path, PathBuf},
};

pub struct Index(HashSet<PathBuf>);

impl Index {
    /// Every entry that isn't a directory, relative to `root`. Symbolic links to files are
    /// listed; links to directories aren't followed.
    pub fn list(root: &Path) -> io::Result<Self> {
        fn walk(root: &Path, directory: &Path, paths: &mut HashSet<PathBuf>) -> io::Result<()> {
            for entry in std::fs::read_dir(directory)? {
                let entry = entry?;
                let path = entry.path();
                let kind = entry.file_type()?;
                if kind.is_dir() {
                    walk(root, &path, paths)?;
                } else if !kind.is_symlink() || !path.is_dir() {
                    let relative = path.strip_prefix(root).map_err(io::Error::other)?;
                    paths.insert(relative.to_path_buf());
                }
            }
            Ok(())
        }
        let mut paths = HashSet::new();
        walk(root, root, &mut paths)?;
        Ok(Self(paths))
    }
    pub fn len(&self) -> usize {
        self.0.len()
    }
    /// Whether `ServeDir` would find a file for this request path: the same decoding and
    /// components, and a trailing slash names only a directory.
    pub fn contains(&self, request_path: &str) -> bool {
        let path = request_path.trim_start_matches('/');
        if path.is_empty() || path.ends_with('/') {
            return false;
        }
        let Ok(decoded) = percent_encoding::percent_decode_str(path).decode_utf8() else {
            return false;
        };
        let mut relative = PathBuf::new();
        for component in Path::new(&*decoded).components() {
            match component {
                Component::Normal(part) => relative.push(part),
                Component::CurDir => {}
                Component::Prefix(_) | Component::RootDir | Component::ParentDir => return false,
            }
        }
        self.0.contains(&relative)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_files_below_the_root_and_matches_request_paths_as_serve_dir_does() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        std::fs::create_dir_all(root.join("assets/fonts")).unwrap();
        std::fs::write(root.join("assets/app.js"), "").unwrap();
        std::fs::write(root.join("assets/app.js.gz"), "").unwrap();
        std::fs::write(root.join("assets/fonts/a b.woff2"), "").unwrap();
        std::fs::write(root.join("backup.gz"), "").unwrap();
        std::os::unix::fs::symlink(root.join("assets"), root.join("linked")).unwrap();
        let index = Index::list(root).unwrap();
        assert_eq!(index.len(), 4);
        for path in [
            "/assets/app.js",
            "/assets//app.js",
            "/./assets/app.js",
            "/assets/fonts/a%20b.woff2",
            "/backup.gz",
        ] {
            assert!(index.contains(path), "{path}");
        }
        for path in [
            "/",
            "/assets",
            "/assets/",
            "/assets/app.js/",
            "/assets/../assets/app.js",
            "/backup",
            "/linked/app.js",
            "/assets/%ff",
        ] {
            assert!(!index.contains(path), "{path}");
        }
    }
}
