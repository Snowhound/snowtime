//! The server's settings, from the same environment variables the TypeScript server reads.

pub struct Config {
    pub database_path: String,
    pub oauth: Vec<OAuthProvider>,
    // BETTER_AUTH_URL: the app's public URL, whose origin writes must come from.
    pub app_url: String,
    pub secret: String,
    // Password sign-in is for local development and demo deployments (passwordEnabled).
    pub password_enabled: bool,
    pub sign_in_page: SignInPageConfig,
    pub client_ip_header: Option<String>,
    pub rate_limit: bool,
}

#[derive(Default)]
pub struct SignInPageConfig {
    pub demo_mode: bool,
    pub allowed_domains: Vec<String>,
    pub providers: Vec<String>,
}

impl Config {
    pub fn secure(&self) -> bool {
        self.app_url.starts_with("https://")
    }

    // The app URL's origin: scheme, host, and port, without a path.
    pub fn app_origin(&self) -> &str {
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

#[derive(Clone)]
pub struct OAuthProvider {
    pub id: String,
    pub client_id: String,
    pub client_secret: String,
    pub tenant: String,
}
