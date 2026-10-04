//! The proof of concept on Actix Web with the rules on rusqlite and SQL strings (task
//! 081.03). Every route goes to the framework-free API (snowtime-api); Actix only carries
//! requests.
use std::sync::Arc;

use actix_web::http::StatusCode;
use actix_web::http::header::{CACHE_CONTROL, CONTENT_TYPE, SET_COOKIE};
use actix_web::{App, HttpRequest, HttpResponse, HttpServer, web};
use snowtime_api::{Api, Config, Request};
use snowtime_rules_sql::SqlRules;

type AppState = Arc<Api<SqlRules>>;

async fn call(api: web::Data<AppState>, request: HttpRequest, body: web::Bytes) -> HttpResponse {
    let text = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned)
    };
    let client_ip = api.config().client_ip_header.as_deref().and_then(text);
    let answer = api
        .handle(Request {
            method: request.method().as_str().to_owned(),
            path: request.path().to_owned(),
            query: Some(request.query_string().to_owned()).filter(|q| !q.is_empty()),
            cookie: text("cookie"),
            origin: text("origin"),
            user_agent: text("user-agent"),
            client_ip,
            body: body.to_vec(),
        })
        .await;
    let status = StatusCode::from_u16(answer.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let mut response = HttpResponse::build(status);
    response.insert_header((CONTENT_TYPE, "application/json"));
    response.insert_header((CACHE_CONTROL, "no-store"));
    if let Some(cookie) = answer.set_cookie {
        response.insert_header((SET_COOKIE, cookie));
    }
    response.body(answer.body)
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    snowtime_core::clock::init_from_env();
    let config = Config::from_env().unwrap_or_else(|message| panic!("{message}"));
    let address = (config.host.clone(), config.port);
    let api = web::Data::new(Api::open(config, SqlRules).expect("the database opens"));
    let server = HttpServer::new(move || {
        App::new()
            .app_data(api.clone())
            .default_service(web::to(call))
    })
    .bind(address)?;
    eprintln!("[snowtime-actix] Listening on {:?}", server.addrs());
    server.run().await
}
