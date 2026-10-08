//! JSON objects whose field order follows JavaScript serialization.
use serde::{
    Deserialize, Deserializer, Serialize, Serializer,
    de::{MapAccess, SeqAccess, Visitor},
    ser::{SerializeMap, SerializeSeq},
};
use serde_json::Value;
use std::{collections::HashMap, fmt};

#[derive(Clone)]
pub(super) enum OrderedJson {
    Scalar(Value),
    Array(Vec<Self>),
    Object(Vec<(String, Self)>),
}
impl Serialize for OrderedJson {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Scalar(v) => v.serialize(s),
            Self::Array(a) => {
                let mut seq = s.serialize_seq(Some(a.len()))?;
                for v in a {
                    seq.serialize_element(v)?;
                }
                seq.end()
            }
            Self::Object(pairs) => {
                let mut map = s.serialize_map(Some(pairs.len()))?;
                for (k, v) in pairs {
                    map.serialize_entry(k, v)?;
                }
                map.end()
            }
        }
    }
}
impl<'de> Deserialize<'de> for OrderedJson {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct JsonVisitor;
        impl<'de> Visitor<'de> for JsonVisitor {
            type Value = OrderedJson;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("JSON")
            }
            fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
                Ok(OrderedJson::Scalar(Value::Null))
            }
            fn visit_bool<E: serde::de::Error>(self, v: bool) -> Result<Self::Value, E> {
                Ok(OrderedJson::Scalar(v.into()))
            }
            fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<Self::Value, E> {
                Ok(OrderedJson::Scalar(v.into()))
            }
            fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<Self::Value, E> {
                Ok(OrderedJson::Scalar(v.into()))
            }
            fn visit_f64<E: serde::de::Error>(self, v: f64) -> Result<Self::Value, E> {
                Ok(OrderedJson::Scalar(Value::from(v)))
            }
            fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Self::Value, E> {
                Ok(OrderedJson::Scalar(v.into()))
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut a: A) -> Result<Self::Value, A::Error> {
                let mut values = vec![];
                while let Some(v) = a.next_element()? {
                    values.push(v);
                }
                Ok(OrderedJson::Array(values))
            }
            fn visit_map<A: MapAccess<'de>>(self, mut a: A) -> Result<Self::Value, A::Error> {
                let mut pairs: Vec<(String, OrderedJson)> = vec![];
                let mut positions = HashMap::<String, usize>::new();
                while let Some((k, v)) = a.next_entry::<String, OrderedJson>()? {
                    if let Some(&position) = positions.get(&k) {
                        pairs[position].1 = v;
                    } else {
                        positions.insert(k.clone(), pairs.len());
                        pairs.push((k, v));
                    }
                }
                fn index(s: &str) -> Option<u32> {
                    s.parse::<u32>()
                        .ok()
                        .filter(|n| *n < u32::MAX && n.to_string() == s)
                }
                pairs.sort_by(|(a, _), (b, _)| match (index(a), index(b)) {
                    (Some(a), Some(b)) => a.cmp(&b),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    _ => std::cmp::Ordering::Equal,
                });
                Ok(OrderedJson::Object(pairs))
            }
        }
        d.deserialize_any(JsonVisitor)
    }
}
pub(super) struct MetadataInput;
impl MetadataInput {
    pub(super) fn parse(bytes: &[u8], update: bool) -> Option<OrderedJson> {
        let data;
        let bytes = if update {
            data = raw_field(bytes, "data")?;
            data.get().as_bytes()
        } else {
            bytes
        };
        serde_json::from_str(raw_field(bytes, "metadata")?.get()).ok()
    }
}
fn raw_field(bytes: &[u8], field: &'static str) -> Option<Box<serde_json::value::RawValue>> {
    struct Field(&'static str);
    impl<'de> Visitor<'de> for Field {
        type Value = Option<Box<serde_json::value::RawValue>>;
        fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
            f.write_str("object")
        }
        fn visit_map<A: MapAccess<'de>>(self, mut a: A) -> Result<Self::Value, A::Error> {
            let mut value = None;
            while let Some(key) = a.next_key::<String>()? {
                if key == self.0 {
                    value = Some(a.next_value()?);
                } else {
                    a.next_value::<serde::de::IgnoredAny>()?;
                }
            }
            Ok(value)
        }
    }
    let mut d = serde_json::Deserializer::from_slice(bytes);
    d.deserialize_map(Field(field)).ok().flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn duplicate_keys_keep_first_position_and_last_value_with_js_index_order() {
        let value: OrderedJson =
            serde_json::from_str(r#"{"b":1,"2":2,"a":3,"1":4,"b":5}"#).unwrap();
        assert_eq!(
            serde_json::to_string(&value).unwrap(),
            r#"{"1":4,"2":2,"b":5,"a":3}"#
        );
    }
    #[test]
    fn two_hundred_thousand_keys_parse_within_five_seconds() {
        use std::{
            fmt::Write,
            time::{Duration, Instant},
        };
        let mut json = String::from("{");
        for i in 0..200_000 {
            if i != 0 {
                json.push(',');
            }
            write!(json, "\"key{i}\":{i}").unwrap();
        }
        json.push('}');
        let start = Instant::now();
        let value: OrderedJson = serde_json::from_str(&json).unwrap();
        assert!(start.elapsed() < Duration::from_secs(5));
        let OrderedJson::Object(pairs) = value else {
            panic!("object")
        };
        assert_eq!(pairs.len(), 200_000);
        assert_eq!(pairs.first().unwrap().0, "key0");
        assert_eq!(pairs.last().unwrap().0, "key199999");
    }
    #[test]
    fn metadata_preserves_order_and_duplicates_while_ignoring_other_subtrees() {
        for (json, update) in [
            (
                r#"{"pad":{"b":1,"a":2},"metadata":{"b":1,"a":2,"b":3}}"#,
                false,
            ),
            (
                r#"{"pad":{},"data":{"metadata":{"b":1,"a":2,"b":3},"ignored":{}}}"#,
                true,
            ),
        ] {
            let value = MetadataInput::parse(json.as_bytes(), update).unwrap();
            assert_eq!(serde_json::to_string(&value).unwrap(), r#"{"b":3,"a":2}"#);
        }
        assert!(MetadataInput::parse(br#"{"pad":{"a":1}}"#, false).is_none());
        let duplicate = MetadataInput::parse(
            br#"{"metadata":{"old":0},"metadata":{"last":1},"data":3}"#,
            false,
        )
        .unwrap();
        assert_eq!(serde_json::to_string(&duplicate).unwrap(), r#"{"last":1}"#);
        let duplicate = MetadataInput::parse(
            br#"{"data":{"metadata":{"old":0}},"data":{"metadata":{"last":1}}}"#,
            true,
        )
        .unwrap();
        assert_eq!(serde_json::to_string(&duplicate).unwrap(), r#"{"last":1}"#);
    }
}
