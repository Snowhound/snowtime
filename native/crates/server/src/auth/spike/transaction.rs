use super::store::{create_account, create_session, create_user, error};
use super::{LaneStore, Schema};
use async_trait::async_trait;
use better_auth_core::{error::AuthResult, store::*, types::*, wire::*};
use rusqlite::Connection;
use std::{
    sync::{Arc, mpsc},
    time::Instant,
};

type Call = Box<dyn FnOnce(&Connection) -> AuthResult<BoxedTransactionValue> + Send>;
enum Command {
    Call(
        Call,
        tokio::sync::oneshot::Sender<AuthResult<BoxedTransactionValue>>,
    ),
    Finish(bool, tokio::sync::oneshot::Sender<AuthResult<()>>),
}
struct Transaction {
    commands: mpsc::Sender<Command>,
    domains: Arc<Vec<String>>,
}
impl Transaction {
    async fn call<T>(
        &self,
        work: impl FnOnce(&Connection) -> AuthResult<T> + Send + 'static,
    ) -> AuthResult<T>
    where
        T: Send + 'static,
    {
        let (sent, received) = tokio::sync::oneshot::channel();
        self.commands
            .send(Command::Call(
                Box::new(move |db| Ok(Box::new(work(db)?) as BoxedTransactionValue)),
                sent,
            ))
            .map_err(error)?;
        received
            .await
            .map_err(error)??
            .downcast::<T>()
            .map(|value| *value)
            .map_err(|_| error("invalid transaction reply"))
    }
}
#[async_trait]
impl AuthTransaction<Schema> for Transaction {
    async fn create_user(&self, input: CreateUser) -> AuthResult<UserView> {
        let domains = self.domains.clone();
        self.call(move |db| create_user(db, input, &domains)).await
    }
    async fn create_account(&self, input: CreateAccount) -> AuthResult<AccountView> {
        self.call(move |db| create_account(db, input)).await
    }
    async fn create_session(&self, input: CreateSession) -> AuthResult<super::LaneSession> {
        let domains = self.domains.clone();
        self.call(move |db| create_session(db, input, &domains))
            .await
    }
}
#[async_trait]
impl TransactionStore<Schema> for LaneStore {
    async fn transaction_boxed(
        &self,
        work: Box<TransactionWork<Schema>>,
    ) -> AuthResult<BoxedTransactionValue> {
        let (commands, received) = mpsc::channel();
        let (ready, started) = tokio::sync::oneshot::channel();
        let store = self.clone();
        let deadline = self.transaction_deadline;
        let worker = tokio::spawn(async move {
            store
                .run(move |db| {
                    let tx = rusqlite::Transaction::new_unchecked(
                        db,
                        rusqlite::TransactionBehavior::Immediate,
                    )
                    .map_err(error)?;
                    let expires = Instant::now() + deadline;
                    ready
                        .send(())
                        .map_err(|_| error("transaction caller cancelled"))?;
                    loop {
                        match received
                            .recv_timeout(expires.saturating_duration_since(Instant::now()))
                        {
                            Ok(Command::Call(work, reply)) if Instant::now() < expires => {
                                let _ = reply.send(work(&tx));
                            }
                            Ok(Command::Finish(commit, reply)) if Instant::now() < expires => {
                                let result =
                                    if commit { tx.commit() } else { tx.rollback() }.map_err(error);
                                let _ = reply.send(result);
                                return Ok(());
                            }
                            _ => {
                                return Err(error(
                                    "transaction deadline or cancellation; rolled back",
                                ));
                            }
                        }
                    }
                })
                .await
        });
        // Dropping the caller closes the channel. The admitted worker then rolls back,
        // keeping its lane permit and writer until SQLite has released the transaction.
        let tx = Transaction {
            commands,
            domains: self.domains.clone(),
        };
        let result = async {
            started.await.map_err(error)?;
            let value = tokio::time::timeout(deadline, work(&tx))
                .await
                .map_err(|_| error("transaction deadline"))?;
            let (sent, received) = tokio::sync::oneshot::channel();
            tx.commands
                .send(Command::Finish(value.is_ok(), sent))
                .map_err(error)?;
            received.await.map_err(error)??;
            value
        }
        .await;
        drop(tx);
        worker.await.map_err(error)??;
        result
    }
}
