//! One address policy shared by session storage and HTTP rate-limit keys.
use axum::{
    extract::ConnectInfo,
    http::{Extensions, HeaderMap},
};
use std::net::{IpAddr, Ipv6Addr, SocketAddr};

pub fn resolve(
    headers: &HeaderMap,
    extensions: &Extensions,
    trusted_header: Option<&str>,
) -> Option<IpAddr> {
    let address = match trusted_header {
        // The configured listener accepts traffic only from a proxy that overwrites this
        // header. Reject chains and malformed addresses, as Better Auth's getIP does.
        Some(name) => {
            if headers.get_all(name).iter().count() != 1 {
                return None;
            }
            headers.get(name)?.to_str().ok()?.trim().parse().ok()?
        }
        None => extensions.get::<ConnectInfo<SocketAddr>>()?.0.ip(),
    };
    Some(normalize(address))
}

pub fn normalize(address: IpAddr) -> IpAddr {
    match address {
        IpAddr::V6(ip) => match ip.to_ipv4_mapped() {
            Some(ip) => IpAddr::V4(ip),
            // Better Auth's default groups IPv6 addresses by /64.
            None => IpAddr::V6(Ipv6Addr::from(u128::from(ip) & (u128::MAX << 64))),
        },
        ip => ip,
    }
}

pub fn session_address(address: IpAddr) -> String {
    match address {
        IpAddr::V4(ip) => ip.to_string(),
        IpAddr::V6(ip) => ip
            .segments()
            .iter()
            .map(|s| format!("{s:04x}"))
            .collect::<Vec<_>>()
            .join(":"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn direct_mode_ignores_all_forwarded_headers() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", "203.0.113.1".parse().unwrap());
        let mut extensions = Extensions::new();
        extensions.insert(ConnectInfo(
            "192.0.2.10:9999".parse::<SocketAddr>().unwrap(),
        ));
        assert_eq!(
            resolve(&headers, &extensions, None).unwrap().to_string(),
            "192.0.2.10"
        );
        assert_eq!(resolve(&headers, &Extensions::new(), None), None);
    }
    #[test]
    fn proxy_mode_uses_only_a_valid_single_configured_address() {
        let mut headers = HeaderMap::new();
        let mut extensions = Extensions::new();
        extensions.insert(ConnectInfo(
            "192.0.2.10:9999".parse::<SocketAddr>().unwrap(),
        ));
        for invalid in ["bad", "192.0.2.1, 192.0.2.2", ""] {
            headers.insert("x-client-ip", invalid.parse().unwrap());
            assert_eq!(resolve(&headers, &extensions, Some("x-client-ip")), None);
        }
        headers.insert("x-client-ip", " 203.0.113.1 ".parse().unwrap());
        assert_eq!(
            resolve(&headers, &extensions, Some("x-client-ip"))
                .unwrap()
                .to_string(),
            "203.0.113.1"
        );
    }
    #[test]
    fn mapped_ipv4_and_ipv6_subnets_match_better_auth() {
        assert_eq!(
            normalize("::ffff:192.0.2.1".parse().unwrap()),
            "192.0.2.1".parse::<IpAddr>().unwrap()
        );
        let a = normalize("2001:DB8:abcd:1234::1".parse().unwrap());
        assert_eq!(a, normalize("2001:db8:abcd:1234::ffff".parse().unwrap()));
        assert_eq!(
            session_address(a),
            "2001:0db8:abcd:1234:0000:0000:0000:0000"
        );
    }
}
