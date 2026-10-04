use snowtime_server::Config as ServerConfig;
use std::env;
pub struct Config {
    pub server: ServerConfig,
    pub host: String,
    pub port: u16,
    pub edge: crate::edge::Config,
    // At most this many renderers, below what memory allows.
    pub renderers: Option<usize>,
    // Where to find Drizzle's migrations when MIGRATE_ON_START=true, as the TypeScript
    // server's standalone entry reads them.
    pub migrations: Option<std::path::PathBuf>,
}
pub fn from_env() -> Result<Config, String> {
    let var = |name: &str| env::var(name).ok().filter(|v| !v.is_empty());
    let required = |name: &str| var(name).ok_or_else(|| format!("Set {name}."));
    let database = required("TURSO_DATABASE_URL")?;
    let database_path = database
        .strip_prefix("file:")
        .ok_or("TURSO_DATABASE_URL must be a file: URL.")?
        .to_owned();
    let app_url = required("BETTER_AUTH_URL")?;
    let edge = crate::edge::Config::from_env(&app_url)?;
    Ok(Config {
        edge,
        host: var("HOST").unwrap_or_else(|| "0.0.0.0".into()),
        port: var("PORT").map_or(Ok(3000), |p| p.parse().map_err(|_| "PORT is a number."))?,
        migrations: match var("MIGRATE_ON_START").as_deref() {
            None | Some("false") => None,
            Some("true") => Some(
                var("MIGRATIONS_DIR")
                    .unwrap_or_else(|| "drizzle".into())
                    .into(),
            ),
            _ => return Err("MIGRATE_ON_START is true or false.".into()),
        },
        renderers: var("RENDERERS")
            .map(|n| n.parse().map_err(|_| "RENDERERS is a number."))
            .transpose()?,
        server: ServerConfig {
            database_path,
            secret: required("BETTER_AUTH_SECRET")?,
            password_enabled: var("NODE_ENV").as_deref() == Some("development")
                || var("DEMO_MODE").as_deref() == Some("true"),
            client_ip_header: var("CLIENT_IP_HEADER").map(|h| h.to_lowercase()),
            app_url: url::Url::parse(&app_url)
                .expect("validated app origin")
                .origin()
                .ascii_serialization(),
        },
    })
}
