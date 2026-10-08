use snowtime_server::Config as ServerConfig;
use std::env;
pub struct Config {
    pub server: ServerConfig,
    pub read_connections: usize,
    pub limits: snowtime_server::Limits,
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
    let cpus = std::thread::available_parallelism().map_or(1, |n| n.get());
    let read_connections = match var("DB_READ_CONNECTIONS").as_deref() {
        None | Some("auto") => auto_readers(cpus),
        Some(n) => n
            .parse::<usize>()
            .ok()
            .filter(|n| *n <= 256)
            .ok_or("DB_READ_CONNECTIONS is auto or a number from 0 to 256.")?,
    };
    let number = |name: &str, default: usize| -> Result<usize, String> {
        var(name).map_or(Ok(default), |v| {
            v.parse::<usize>()
                .ok()
                .filter(|n| *n > 0 && *n <= 65536)
                .ok_or_else(|| format!("{name} is a number from 1 to 65536."))
        })
    };
    let limits = snowtime_server::Limits {
        hashes: number("SCRYPT_CONCURRENCY", cpus)?.min(snowtime_server::hash_workers(
            crate::memory::limit().bytes,
            cpus,
        )),
        max_waiting: number("WORK_QUEUE_MAX_WAITING", 4096)?,
        queue_timeout: std::time::Duration::from_millis(
            number("WORK_QUEUE_TIMEOUT_MS", 1000)? as u64
        ),
    };
    Ok(Config {
        read_connections,
        limits,
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
            oauth: oauth_config(&var),
            secret: required("BETTER_AUTH_SECRET")?,
            password_enabled: var("NODE_ENV").as_deref() == Some("development")
                || var("DEMO_MODE").as_deref() == Some("true"),
            sign_in_page: sign_in_page_config(&var)?,
            client_ip_header: var("CLIENT_IP_HEADER").map(|h| h.to_lowercase()),
            rate_limit: snowtime_server::rate_limit::enabled(
                var("NODE_ENV").as_deref(),
                var("RATE_LIMIT").as_deref(),
            )?,
            app_url: url::Url::parse(&app_url)
                .expect("validated app origin")
                .origin()
                .ascii_serialization(),
        },
    })
}

fn oauth_config(var: &impl Fn(&str) -> Option<String>) -> Vec<snowtime_server::OAuthProvider> {
    if var("DEMO_MODE").as_deref() == Some("true") {
        return vec![];
    }
    [
        ("GOOGLE", "google"),
        ("GITHUB", "github"),
        ("MICROSOFT", "microsoft"),
    ]
    .into_iter()
    .filter_map(|(prefix, id)| {
        Some(snowtime_server::OAuthProvider {
            id: id.into(),
            client_id: var(&format!("{prefix}_CLIENT_ID"))?,
            client_secret: var(&format!("{prefix}_CLIENT_SECRET"))?,
            tenant: var("MICROSOFT_TENANT_ID").unwrap_or_else(|| "common".into()),
        })
    })
    .collect()
}

fn sign_in_page_config(
    var: &impl Fn(&str) -> Option<String>,
) -> Result<snowtime_server::SignInPageConfig, String> {
    let demo_mode = var("DEMO_MODE").as_deref() == Some("true");
    let mut allowed_domains = Vec::new();
    if let Some(value) = var("ALLOWED_LOGIN_DOMAINS") {
        for domain in value.split(',') {
            let domain = domain.trim().to_lowercase();
            let domain = domain.strip_prefix('@').unwrap_or(&domain).to_owned();
            let labels: Vec<_> = domain.split('.').collect();
            if domain.len() > 253
                || labels.len() < 2
                || labels.iter().any(|label| {
                    label.is_empty()
                        || label.len() > 63
                        || !label.as_bytes()[0].is_ascii_alphanumeric()
                        || !label.as_bytes()[label.len() - 1].is_ascii_alphanumeric()
                        || !label
                            .bytes()
                            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
                })
            {
                return Err(
                    "ALLOWED_LOGIN_DOMAINS must contain comma-separated email domains.".into(),
                );
            }
            if !allowed_domains.contains(&domain) {
                allowed_domains.push(domain);
            }
        }
    }
    if demo_mode && !allowed_domains.is_empty() {
        return Err("DEMO_MODE signs in seeded users; unset ALLOWED_LOGIN_DOMAINS.".into());
    }
    let mut providers = Vec::new();
    for (prefix, method) in [
        ("GOOGLE", "google"),
        ("GITHUB", "github"),
        ("MICROSOFT", "microsoft"),
    ] {
        let id = var(&format!("{prefix}_CLIENT_ID")).is_some();
        let secret = var(&format!("{prefix}_CLIENT_SECRET")).is_some();
        if id != secret {
            return Err(format!(
                "Set both {prefix}_CLIENT_ID and {prefix}_CLIENT_SECRET, or neither."
            ));
        }
        if id {
            providers.push(method.into());
        }
    }
    Ok(snowtime_server::SignInPageConfig {
        demo_mode,
        allowed_domains,
        providers,
    })
}

// A reader per core, but none on one core, where a reader held fewer users than the single
// connection (task 081.10).
fn auto_readers(cpus: usize) -> usize {
    if cpus > 1 { cpus } else { 0 }
}

#[cfg(test)]
mod tests {
    #[test]
    fn sign_in_page_normalizes_domains_and_keeps_provider_order() {
        let vars = [
            (
                "ALLOWED_LOGIN_DOMAINS",
                "@Example.com, lumen.example.com, example.com",
            ),
            ("GOOGLE_CLIENT_ID", "fixture"),
            ("GOOGLE_CLIENT_SECRET", "fixture"),
        ];
        let config = super::sign_in_page_config(&|name| {
            vars.iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| (*value).into())
        })
        .unwrap();
        assert_eq!(config.allowed_domains, ["example.com", "lumen.example.com"]);
        assert_eq!(config.providers, ["google"]);
    }

    #[test]
    fn sign_in_page_refuses_incomplete_providers_and_demo_domain_policy() {
        assert!(
            super::sign_in_page_config(
                &|name| (name == "GOOGLE_CLIENT_ID").then(|| "fixture".into())
            )
            .is_err()
        );
        assert!(
            super::sign_in_page_config(&|name| match name {
                "DEMO_MODE" => Some("true".into()),
                "ALLOWED_LOGIN_DOMAINS" => Some("example.com".into()),
                _ => None,
            })
            .is_err()
        );
        for invalid in ["localhost", "-x.example", "x..example", "@", ""] {
            assert!(
                super::sign_in_page_config(
                    &|name| (name == "ALLOWED_LOGIN_DOMAINS").then(|| invalid.into())
                )
                .is_err()
            );
        }
    }

    #[test]
    fn oauth_credentials_follow_provider_pairs_tenant_and_demo_mode() {
        let vars = [
            ("GOOGLE_CLIENT_ID", "google-id"),
            ("GOOGLE_CLIENT_SECRET", "google-secret"),
            ("MICROSOFT_CLIENT_ID", "microsoft-id"),
            ("MICROSOFT_CLIENT_SECRET", "microsoft-secret"),
            ("MICROSOFT_TENANT_ID", "tenant"),
        ];
        let read = |name: &str| {
            vars.iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| (*value).into())
        };
        let providers = super::oauth_config(&read);
        assert_eq!(providers.len(), 2);
        assert_eq!(providers[0].id, "google");
        assert_eq!(providers[0].client_id, "google-id");
        assert_eq!(providers[0].client_secret, "google-secret");
        assert_eq!(providers[1].id, "microsoft");
        assert_eq!(providers[1].tenant, "tenant");
        assert!(
            super::oauth_config(&|name| if name == "DEMO_MODE" {
                Some("true".into())
            } else {
                read(name)
            })
            .is_empty()
        );
    }

    #[test]
    fn auto_gives_one_core_no_readers() {
        assert_eq!(super::auto_readers(1), 0);
        assert_eq!(super::auto_readers(2), 2);
        assert_eq!(super::auto_readers(8), 8);
    }
}
