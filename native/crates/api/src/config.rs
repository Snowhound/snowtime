//! The server's settings, from the same environment variables the TypeScript server reads.
use std::env;

pub struct Config {
    pub database_path: String,
    // BETTER_AUTH_URL: the app's public URL, whose origin writes must come from.
    pub app_url: String,
    pub secret: String,
    // Password sign-in is for local development and demo deployments (passwordEnabled).
    pub password_enabled: bool,
    pub client_ip_header: Option<String>,
    pub host: String,
    pub port: u16,
}

impl Config {
    pub fn from_env() -> Result<Config, String> {
        let var = |name: &str| env::var(name).ok().filter(|v| !v.is_empty());
        let required = |name: &str| var(name).ok_or_else(|| format!("Set {name}."));
        let database = required("TURSO_DATABASE_URL")?;
        let database_path = database
            .strip_prefix("file:")
            .ok_or("TURSO_DATABASE_URL must be a file: URL.")?
            .to_owned();
        let app_url = required("BETTER_AUTH_URL")?;
        Ok(Config {
            database_path,
            secret: required("BETTER_AUTH_SECRET")?,
            password_enabled: var("NODE_ENV").as_deref() == Some("development")
                || var("DEMO_MODE").as_deref() == Some("true"),
            client_ip_header: var("CLIENT_IP_HEADER").map(|h| h.to_lowercase()),
            host: var("HOST").unwrap_or_else(|| "0.0.0.0".into()),
            port: var("PORT").map_or(Ok(3000), |p| p.parse().map_err(|_| "PORT is a number."))?,
            app_url: app_url.trim_end_matches('/').to_owned(),
        })
    }

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
