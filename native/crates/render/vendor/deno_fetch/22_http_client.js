// Copyright 2018-2026 the Deno authors. MIT license.

// Snowtime: deno_fetch's 22_http_client.js without createHttpClient, which needs the network
// and TLS ops. Request only checks `init.client` against this prototype, so no client passes.
(function () {
class HttpClient {}
const HttpClientPrototype = HttpClient.prototype;

return { HttpClient, HttpClientPrototype };
})();
