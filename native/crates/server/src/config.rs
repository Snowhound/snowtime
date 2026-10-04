//! The server's settings, from the same environment variables the TypeScript server reads.

pub struct Config {
    pub database_path: String,
    // BETTER_AUTH_URL: the app's public URL, whose origin writes must come from.
    pub app_url: String,
    pub secret: String,
    // Password sign-in is for local development and demo deployments (passwordEnabled).
    pub password_enabled: bool,
    pub client_ip_header: Option<String>,
}

impl Config {
    pub fn secure(&self) -> bool {
        self.app_url.starts_with("https://")
    }

    // The app URL's origin: scheme, host, and port, without a path.
    fn app_origin(&self) -> &str {
        let after_scheme = self.app_url.find("://").map_or(0, |i| i + 3);
        let end = self.app_url[after_scheme..]
            .find('/')
            .map_or(self.app_url.len(), |i| i + after_scheme);
        &self.app_url[..end]
    }

    pub fn is_app_origin(&self, origin: Option<&str>) -> bool {
        origin == Some(self.app_origin())
    }
}
