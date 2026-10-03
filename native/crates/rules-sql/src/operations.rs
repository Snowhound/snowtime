//! Each call of the contract run against its rule (src/server/operations.server.ts), with
//! its input and result as JSON. It resolves the scope before it validates the call's own
//! input.
use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;
use snowtime_core::operations::operation;
use snowtime_core::schemas::decode;
use snowtime_core::wire::{ok, refusal};
use snowtime_core::{Access, Error, OperationName, Result, Rules, WireResponse};

use crate::scope::{Scope, resolve_scope};
use crate::{entries, timer};

// Who a call runs for: the user anywhere, or the user in the organization it names.
enum Context {
    User(String),
    Organization(Scope),
}

fn output<T: Serialize>(value: T) -> Result<WireResponse> {
    Ok(ok(&value))
}

// Each call's handler, which runs its rule.
fn handle(
    db: &Connection,
    context: Context,
    name: OperationName,
    input: Value,
) -> Result<WireResponse> {
    use OperationName::*;
    match (name, context) {
        (GetRunningTimer, Context::User(user_id)) => {
            output(timer::get_running_timer(db, &user_id)?)
        }
        (StartTimer, Context::Organization(scope)) => {
            output(timer::start_timer(db, &scope, decode(input)?)?)
        }
        (StopTimer, Context::User(user_id)) => {
            output(timer::stop_timer(db, &user_id, decode(input)?)?)
        }
        (ListEntries, Context::Organization(scope)) => {
            output(entries::list_entries(db, &scope, decode(input)?)?)
        }
        (GetFirstEntryStart, Context::Organization(scope)) => {
            output(entries::get_first_entry_start(db, &scope, decode(input)?)?)
        }
        (CreateEntry, Context::Organization(scope)) => {
            output(entries::create_entry(db, &scope, decode(input)?)?)
        }
        (UpdateEntry, Context::Organization(scope)) => {
            output(entries::update_entry(db, &scope, decode(input)?)?)
        }
        (DeleteEntry, Context::Organization(scope)) => {
            output(entries::delete_entry(db, &scope, decode(input)?)?)
        }
        _ => unreachable!("{name:?} has no handler for its scope"),
    }
}

// The organization an organization-scoped call acts in (parseOrganizationInput).
fn organization_input(input: &Value) -> Result<String> {
    match input.get("organizationId") {
        Some(Value::String(id)) if !id.is_empty() => Ok(id.clone()),
        _ => Err(Error::Invalid("Invalid organization.".into())),
    }
}

pub struct SqlRules;

impl Rules for SqlRules {
    fn run_operation(
        &self,
        db: &Connection,
        name: OperationName,
        user_id: &str,
        input: Value,
    ) -> Result<WireResponse> {
        let result = (|| {
            let context = match operation(name).scope {
                Access::Organization => {
                    let organization_id = organization_input(&input)?;
                    Context::Organization(resolve_scope(db, user_id, &organization_id)?)
                }
                _ => Context::User(user_id.to_owned()),
            };
            handle(db, context, name, input)
        })();
        result.or_else(|error| refusal(error).map_err(Error::Database))
    }
}
