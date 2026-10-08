use std::{path::PathBuf, time::Duration};

#[derive(Clone, Debug)]
pub enum Tls {
    Plain,
    Files {
        certificate: PathBuf,
        key: PathBuf,
    },
    Acme {
        domains: Vec<String>,
        contact: Vec<String>,
        cache: PathBuf,
        staging: bool,
    },
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AccessLog {
    Off,
    Sampled,
    All,
}
#[derive(Clone, Debug)]
pub struct Config {
    pub tls: Tls,
    pub redirect_port: Option<u16>,
    pub compression: bool,
    pub access_log: AccessLog,
    pub headers: bool,
    pub static_dir: Option<PathBuf>,
    pub timeout_seconds: u64,
    pub body_limit: usize,
    pub header_timeout: Duration,
    pub connections: super::connections::Limits,
    pub bench_log: Option<PathBuf>,
}
impl Config {
    pub fn from_env(app_url: &str) -> Result<Self, String> {
        Self::read(app_url, |name| {
            std::env::var(name).ok().filter(|v| !v.is_empty())
        })
    }
    pub fn read(app_url: &str, var: impl Fn(&str) -> Option<String>) -> Result<Self, String> {
        let url = url::Url::parse(app_url).map_err(|_| "BETTER_AUTH_URL is an origin URL.")?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || !matches!(url.path(), "" | "/")
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err("BETTER_AUTH_URL is an HTTP(S) origin without credentials, path, query, or fragment.".into());
        }
        let flag = |name, default| match var(name).as_deref() {
            None => Ok(default),
            Some("true") => Ok(true),
            Some("false") => Ok(false),
            _ => Err(format!("{name} is true or false.")),
        };
        let number = |name, default| match var(name) {
            None => Ok(default),
            Some(value) => value
                .parse::<u64>()
                .map_err(|_| format!("{name} is a nonnegative integer.")),
        };
        let seconds = |name, default| match number(name, default)? {
            0 => Err(format!("{name} is a positive integer.")),
            n => Ok(Duration::from_secs(n)),
        };
        let count = |name, default| {
            usize::try_from(number(name, default)?).map_err(|_| format!("{name} is too large."))
        };
        let domains = var("ACME_DOMAINS");
        let tls = match (var("TLS_CERT_FILE"), var("TLS_KEY_FILE"), domains) {
            (None, None, None) => Tls::Plain,
            (Some(certificate), Some(key), None) => Tls::Files {
                certificate: certificate.into(),
                key: key.into(),
            },
            (None, None, Some(domains)) => {
                let domains: Vec<String> =
                    domains.split(',').map(|d| d.trim().to_owned()).collect();
                if domains.iter().any(|d| {
                    d.is_empty() || d.contains(['/', ':', '*']) || d.contains(char::is_whitespace)
                }) {
                    return Err("ACME_DOMAINS is a comma-separated list of DNS names; TLS-ALPN-01 does not support wildcards.".into());
                }
                let url =
                    url::Url::parse(app_url).map_err(|_| "BETTER_AUTH_URL is an origin URL.")?;
                if !domains.iter().any(|d| Some(d.as_str()) == url.host_str()) {
                    return Err("ACME_DOMAINS must include BETTER_AUTH_URL's hostname.".into());
                }
                Tls::Acme {
                    domains,
                    contact: var("ACME_EMAIL")
                        .map(|email| vec![format!("mailto:{email}")])
                        .unwrap_or_default(),
                    cache: var("ACME_CACHE_DIR")
                        .unwrap_or_else(|| "/data/acme".into())
                        .into(),
                    staging: flag("ACME_STAGING", false)?,
                }
            }
            _ => {
                return Err(
                    "Set both TLS_CERT_FILE and TLS_KEY_FILE, or ACME_DOMAINS, not both modes."
                        .into(),
                );
            }
        };
        if !matches!(tls, Tls::Plain) && url.scheme() != "https" {
            return Err("TLS requires an https:// BETTER_AUTH_URL.".into());
        }
        let redirect_port = var("HTTP_REDIRECT_PORT")
            .map(|value| {
                value
                    .parse::<u16>()
                    .map_err(|_| "HTTP_REDIRECT_PORT is a port number.".to_owned())
            })
            .transpose()?;
        if redirect_port.is_some() && matches!(tls, Tls::Plain) {
            return Err("HTTP_REDIRECT_PORT requires TLS.".into());
        }
        Ok(Self {
            tls,
            redirect_port,
            compression: flag("EDGE_COMPRESSION", true)?,
            access_log: match var("EDGE_ACCESS_LOG").as_deref() {
                None | Some("all") => AccessLog::All,
                Some("sampled") => AccessLog::Sampled,
                Some("off") => AccessLog::Off,
                _ => return Err("EDGE_ACCESS_LOG is all, sampled, or off.".into()),
            },
            headers: flag("EDGE_HEADERS", true)?,
            static_dir: var("EDGE_STATIC_DIR").map(PathBuf::from),
            timeout_seconds: number("EDGE_TIMEOUT_SECONDS", 30)?,
            body_limit: count("EDGE_BODY_LIMIT_BYTES", 2 * 1024 * 1024)?,
            header_timeout: seconds("EDGE_HEADER_TIMEOUT_SECONDS", 30)?,
            connections: super::connections::Limits {
                total: count("EDGE_MAX_CONNECTIONS", 4096)?,
                // Behind a proxy every connection comes from the proxy's address.
                per_address: count(
                    "EDGE_MAX_CONNECTIONS_PER_ADDRESS",
                    if var("CLIENT_IP_HEADER").is_some() {
                        0
                    } else {
                        256
                    },
                )?,
                idle: seconds("EDGE_IDLE_TIMEOUT_SECONDS", 60)?,
            },
            bench_log: var("EDGE_BENCH_LOG").map(PathBuf::from),
        })
    }
}
