//! One address policy shared by session storage and HTTP rate-limit keys.
use axum::{
    extract::ConnectInfo,
    http::{Extensions, HeaderMap},
};
use std::net::{IpAddr, Ipv6Addr, SocketAddr};

/// CLIENT_IP_HEADER, and CLIENT_IP_TRUSTED_PROXIES: the peers it's read from. With no
/// proxies listed, every peer is trusted.
#[derive(Clone, Debug)]
pub struct ClientIpHeader {
    pub name: String,
    pub proxies: Vec<Cidr>,
}
impl ClientIpHeader {
    fn trusts(&self, peer: Option<IpAddr>) -> bool {
        self.proxies.is_empty()
            || peer.is_some_and(|peer| self.proxies.iter().any(|cidr| cidr.contains(peer)))
    }
}

/// An address range, such as `173.245.48.0/20`; a bare address is its own range.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Cidr {
    network: IpAddr,
    prefix: u8,
}
impl Cidr {
    pub fn parse_list(value: &str) -> Result<Vec<Self>, String> {
        value
            .split(',')
            .map(|item| item.trim().parse())
            .collect::<Result<_, _>>()
            .map_err(|()| "CLIENT_IP_TRUSTED_PROXIES is a comma-separated list of CIDRs.".into())
    }
    pub fn contains(&self, address: IpAddr) -> bool {
        match (self.network, address.to_canonical()) {
            (IpAddr::V4(network), IpAddr::V4(address)) => {
                let mask = u32::MAX
                    .checked_shl(32 - u32::from(self.prefix))
                    .unwrap_or(0);
                u32::from(network) & mask == u32::from(address) & mask
            }
            (IpAddr::V6(network), IpAddr::V6(address)) => {
                let mask = u128::MAX
                    .checked_shl(128 - u32::from(self.prefix))
                    .unwrap_or(0);
                u128::from(network) & mask == u128::from(address) & mask
            }
            _ => false,
        }
    }
}
impl std::str::FromStr for Cidr {
    type Err = ();
    fn from_str(value: &str) -> Result<Self, ()> {
        let (address, prefix) = value
            .split_once('/')
            .map_or((value, None), |(a, p)| (a, Some(p)));
        let network = address.parse::<IpAddr>().map_err(|_| ())?.to_canonical();
        let bits = if network.is_ipv4() { 32 } else { 128 };
        let prefix = match prefix {
            None => bits,
            Some(prefix) => prefix.parse::<u8>().ok().filter(|p| *p <= bits).ok_or(())?,
        };
        Ok(Self { network, prefix })
    }
}

pub fn resolve(
    headers: &HeaderMap,
    extensions: &Extensions,
    trusted: Option<&ClientIpHeader>,
) -> Option<IpAddr> {
    let peer = extensions
        .get::<ConnectInfo<SocketAddr>>()
        .map(|c| c.0.ip());
    let address = match trusted {
        // Only a proxy that overwrites this header may send it. Reject chains and
        // malformed addresses, as Better Auth's getIP does.
        Some(header) if header.trusts(peer) => {
            if headers.get_all(&header.name).iter().count() != 1 {
                return None;
            }
            headers
                .get(&header.name)?
                .to_str()
                .ok()?
                .trim()
                .parse()
                .ok()?
        }
        _ => peer?,
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
    fn header(proxies: &str) -> ClientIpHeader {
        ClientIpHeader {
            name: "x-client-ip".into(),
            proxies: if proxies.is_empty() {
                vec![]
            } else {
                Cidr::parse_list(proxies).unwrap()
            },
        }
    }
    #[test]
    fn proxy_mode_uses_only_a_valid_single_configured_address() {
        let header = header("");
        let mut headers = HeaderMap::new();
        let mut extensions = Extensions::new();
        extensions.insert(ConnectInfo(
            "192.0.2.10:9999".parse::<SocketAddr>().unwrap(),
        ));
        for invalid in ["bad", "192.0.2.1, 192.0.2.2", ""] {
            headers.insert("x-client-ip", invalid.parse().unwrap());
            assert_eq!(resolve(&headers, &extensions, Some(&header)), None);
        }
        headers.insert("x-client-ip", " 203.0.113.1 ".parse().unwrap());
        assert_eq!(
            resolve(&headers, &extensions, Some(&header))
                .unwrap()
                .to_string(),
            "203.0.113.1"
        );
    }
    #[test]
    fn listed_proxies_alone_may_set_the_address() {
        let header = header("192.0.2.0/24, 2001:db8::1");
        let mut headers = HeaderMap::new();
        headers.insert("x-client-ip", "203.0.113.1".parse().unwrap());
        for (peer, expected) in [
            ("192.0.2.10:443", "203.0.113.1"),
            ("[::ffff:192.0.2.10]:443", "203.0.113.1"),
            ("[2001:db8::1]:443", "203.0.113.1"),
            ("198.51.100.7:443", "198.51.100.7"),
            ("[2001:db8::2]:443", "2001:db8::"),
        ] {
            let mut extensions = Extensions::new();
            extensions.insert(ConnectInfo(peer.parse::<SocketAddr>().unwrap()));
            assert_eq!(
                resolve(&headers, &extensions, Some(&header))
                    .unwrap()
                    .to_string(),
                expected,
                "{peer}"
            );
        }
        // No peer, as no listener leaves it, trusts nothing.
        assert_eq!(resolve(&headers, &Extensions::new(), Some(&header)), None);
        for invalid in [
            "",
            "192.0.2.0/33",
            "::/129",
            "192.0.2.0/",
            "proxy",
            "192.0.2.0/24,",
        ] {
            assert!(Cidr::parse_list(invalid).is_err(), "{invalid}");
        }
        assert!(
            Cidr::parse_list("0.0.0.0/0").unwrap()[0].contains("198.51.100.7".parse().unwrap())
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
