use super::LaneStore;
use super::store::{error, execute, id, now, one, query};
use async_trait::async_trait;
use base64::{Engine, engine::general_purpose::STANDARD};
use better_auth_core::{error::AuthResult, store::PasskeyStore, types::*};
use serde_json::json;
use webauthn_rs_core::proto::{COSEKey, Credential};

// Snowtime persists the COSE key, not webauthn-rs's private serialized envelope.
// Reconstruct only the fields this app uses; it does not evaluate attestations.
fn credential(passkey: &Passkey) -> AuthResult<String> {
    let cbor: serde_cbor_2::Value =
        serde_cbor_2::from_slice(&STANDARD.decode(&passkey.public_key).map_err(error)?)
            .map_err(error)?;
    let key = COSEKey::try_from(&cbor).map_err(error)?;
    let transports = passkey
        .transports
        .as_ref()
        .map(|s| s.split(',').collect::<Vec<_>>());
    let value = json!({"cred":{
        "cred_id":passkey.credential_id,"cred":key,"counter":passkey.counter,
        "transports":transports,"user_verified":false,"backup_eligible":passkey.device_type=="multiDevice",
        "backup_state":passkey.backed_up,"registration_policy":"preferred",
        "extensions":{},"attestation":{"data":"None","metadata":"None"},"attestation_format":"none"
    }});
    // Parse the inner credential too, so a dependency shape change fails immediately.
    let _: Credential = serde_json::from_value(value["cred"].clone()).map_err(error)?;
    Ok(value.to_string())
}
fn mapped(mut passkey: Passkey) -> AuthResult<Passkey> {
    passkey.credential = credential(&passkey)?;
    Ok(passkey)
}
#[async_trait]
impl PasskeyStore for LaneStore {
    async fn create_passkey(&self, input: CreatePasskey) -> AuthResult<Passkey> {
        self.run(move |db| {
            let id=id();
            execute(db,"insert into passkey (id,name,public_key,user_id,credential_id,counter,device_type,backed_up,transports,created_at,aaguid) values (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",vec![json!(id),json!(input.name),json!(input.public_key),json!(input.user_id),json!(input.credential_id),json!(input.counter),json!(input.device_type),json!(input.backed_up),json!(input.transports),json!(now()),json!(input.aaguid)])?;
            mapped(one(db,"select * from passkey where id=?1",vec![json!(id)])?)
        }).await
    }
    async fn get_passkey_by_id(&self, id: &str) -> AuthResult<Option<Passkey>> {
        let id = id.to_owned();
        self.run(move |db| {
            query(db, "select * from passkey where id=?1", vec![json!(id)])?
                .into_iter()
                .next()
                .map(mapped)
                .transpose()
        })
        .await
    }
    async fn get_passkey_by_credential_id(
        &self,
        credential_id: &str,
    ) -> AuthResult<Option<Passkey>> {
        let id = credential_id.to_owned();
        self.run(move |db| {
            query(
                db,
                "select * from passkey where credential_id=?1",
                vec![json!(id)],
            )?
            .into_iter()
            .next()
            .map(mapped)
            .transpose()
        })
        .await
    }
    async fn list_passkeys_by_user(&self, user_id: &str) -> AuthResult<Vec<Passkey>> {
        let id = user_id.to_owned();
        self.run(move |db| {
            query(
                db,
                "select * from passkey where user_id=?1",
                vec![json!(id)],
            )?
            .into_iter()
            .map(mapped)
            .collect()
        })
        .await
    }
    async fn update_passkey_authentication(
        &self,
        id: &str,
        update: UpdatePasskeyAuthentication,
    ) -> AuthResult<Passkey> {
        let id = id.to_owned();
        self.run(move |db| {
            execute(db,"update passkey set counter=max(counter,?1),backed_up=?2,device_type=?3 where id=?4",vec![json!(update.counter),json!(update.backed_up),json!(update.device_type),json!(id)])?;
            mapped(one(db,"select * from passkey where id=?1",vec![json!(id)])?)
        }).await
    }
    async fn update_passkey_name(&self, id: &str, name: &str) -> AuthResult<Passkey> {
        let id = id.to_owned();
        let name = name.to_owned();
        self.run(move |db| {
            execute(
                db,
                "update passkey set name=?1 where id=?2",
                vec![json!(name), json!(id)],
            )?;
            mapped(one(
                db,
                "select * from passkey where id=?1",
                vec![json!(id)],
            )?)
        })
        .await
    }
    async fn delete_passkey(&self, id: &str) -> AuthResult<()> {
        let id = id.to_owned();
        self.run(move |db| {
            execute(db, "delete from passkey where id=?1", vec![json!(id)])?;
            Ok(())
        })
        .await
    }
}
