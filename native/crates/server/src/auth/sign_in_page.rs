use super::schemas::{Deployment, DevUser};
use crate::{Config, Result};
use rusqlite::Connection;

pub fn sign_in_methods(_: &Connection, config: &Config) -> Result<Vec<String>> {
    let mut methods = if config.sign_in_page.demo_mode {
        Vec::new()
    } else {
        config.sign_in_page.providers.clone()
    };
    if config.password_enabled {
        methods.push("password".into());
    }
    methods.push("passkey".into());
    Ok(methods)
}

pub fn get_deployment(_: &Connection, config: &Config) -> Result<Deployment> {
    Ok(Deployment {
        demo_mode: config.sign_in_page.demo_mode,
        allowed_domains: config.sign_in_page.allowed_domains.clone(),
    })
}

const SEED_USERS: &[(&str, &str)] = &[
    ("Olivia Owner", "owner@example.com"),
    ("Adam Admin", "admin@example.com"),
    ("Lena Lead", "lead@example.com"),
    ("Max Member", "member@example.com"),
    ("Theo Lead", "theo@example.com"),
    ("Mia Engineer", "mia@example.com"),
    ("Noah Solo", "noah@example.com"),
];
const COMPANY_USERS: &[(&str, &str)] = &[
    ("Kristiina Kask", "kristiina@lumen.example.com"),
    ("Jonas Berg", "jonas@lumen.example.com"),
    ("Sofia Rossi", "sofia@lumen.example.com"),
    ("Daniel Park", "daniel@lumen.example.com"),
    ("Marta Nowak", "marta@lumen.example.com"),
];

pub fn get_dev_users(db: &Connection, config: &Config) -> Result<Vec<DevUser>> {
    if !config.password_enabled {
        return Ok(Vec::new());
    }
    let company_emails: Vec<_> = COMPANY_USERS.iter().map(|(_, email)| *email).collect();
    let emails = crate::sql!(
        "select email from user where email in ",
        crate::queries::list(&company_emails)
    )
    .query(db, |row| row.get::<_, String>(0))?;
    Ok(SEED_USERS
        .iter()
        .chain(
            COMPANY_USERS
                .iter()
                .filter(|(_, email)| emails.iter().any(|e| e == email)),
        )
        .map(|&(name, email)| DevUser {
            name,
            email,
            password: "snowtime-local",
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> Config {
        Config {
            database_path: String::new(),
            app_url: "http://snowtime.test".into(),
            secret: "secret".into(),
            password_enabled: true,
            sign_in_page: Default::default(),
            client_ip_header: None,
            oauth: vec![],
        }
    }

    #[test]
    fn methods_follow_provider_order_and_demo_hides_providers() {
        let db = Connection::open_in_memory().unwrap();
        let mut config = config();
        config.sign_in_page.providers = vec!["google".into(), "github".into(), "microsoft".into()];
        assert_eq!(
            sign_in_methods(&db, &config).unwrap(),
            ["google", "github", "microsoft", "password", "passkey"]
        );
        config.sign_in_page.demo_mode = true;
        assert_eq!(
            sign_in_methods(&db, &config).unwrap(),
            ["password", "passkey"]
        );
        config.password_enabled = false;
        assert_eq!(sign_in_methods(&db, &config).unwrap(), ["passkey"]);
        assert!(get_dev_users(&db, &config).unwrap().is_empty());
    }

    #[test]
    fn seed_names_and_order_are_static_and_company_users_require_a_row() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("create table user (email text, name text); insert into user values ('marta@lumen.example.com', 'Changed'), ('kristiina@lumen.example.com', 'Changed');").unwrap();
        let users = get_dev_users(&db, &config()).unwrap();
        assert_eq!(users.len(), 9);
        assert_eq!(users[7].name, "Kristiina Kask");
        assert_eq!(users[8].name, "Marta Nowak");
    }
}
