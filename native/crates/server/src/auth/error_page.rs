//! Better Auth 1.7.7's error page (api/routes/error.mjs), where OAuth errors without an
//! error URL redirect. Snowtime sets no onAPIError options, so the page has its defaults.
use crate::http::{App, Request};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use std::sync::Arc;

impl App {
    pub(crate) async fn error_page(self: Arc<Self>, request: Request) -> Response {
        if let Err(refused) = self.clone().login_domain_middleware(&request).await {
            return refused.into_response();
        }
        let query = request.query.as_deref().unwrap_or("");
        let first = |name: &str| {
            form_urlencoded::parse(query.as_bytes())
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.into_owned())
                .filter(|value| !value.is_empty())
        };
        let raw_code = first("error").unwrap_or_else(|| "UNKNOWN".into());
        let code = if raw_code
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"'_-".contains(&b))
        {
            raw_code
        } else {
            "UNKNOWN".into()
        };
        let description = first("error_description");
        if self.config.production {
            let mut params = form_urlencoded::Serializer::new(String::new());
            params.append_pair("error", &code);
            if let Some(description) = &description {
                params.append_pair("error_description", description);
            }
            let location = format!("/?{}", params.finish());
            let mut response = StatusCode::FOUND.into_response();
            if let Ok(location) = HeaderValue::from_str(&location) {
                response.headers_mut().insert(header::LOCATION, location);
            }
            return response;
        }
        (
            [(header::CONTENT_TYPE, HeaderValue::from_static("text/html"))],
            page(&code, description.as_deref().map(sanitize).as_deref()),
        )
            .into_response()
    }
}

// Better Auth's sanitize: escape markup characters, then any ampersand that doesn't start an
// entity.
fn sanitize(input: &str) -> String {
    let escaped = input
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;");
    let mut out = String::with_capacity(escaped.len());
    for (at, character) in escaped.char_indices() {
        if character == '&' && !starts_entity(&escaped[at + 1..]) {
            out.push_str("&amp;");
        } else {
            out.push(character);
        }
    }
    out
}

// /amp;|lt;|gt;|quot;|#39;|#x[0-9a-fA-F]+;|#[0-9]+;/ at the start of the text.
fn starts_entity(text: &str) -> bool {
    let digits = |rest: &str, hex: bool| {
        let count = rest
            .bytes()
            .take_while(|b| {
                if hex {
                    b.is_ascii_hexdigit()
                } else {
                    b.is_ascii_digit()
                }
            })
            .count();
        count > 0 && rest[count..].starts_with(';')
    };
    ["amp;", "lt;", "gt;", "quot;", "#39;"]
        .iter()
        .any(|entity| text.starts_with(entity))
        || text
            .strip_prefix("#x")
            .is_some_and(|rest| digits(rest, true))
        || text
            .strip_prefix('#')
            .is_some_and(|rest| digits(rest, false))
}

// The code is letters, digits, `'`, `_`, and `-`, which encodeURIComponent leaves as they are.
fn page(code: &str, description: Option<&str>) -> String {
    let code_html = code.replace('\'', "&#39;");
    let default_description;
    let description = match description {
        Some(description) => description,
        None => {
            default_description = DEFAULT_DESCRIPTION.replace("{{code}}", code);
            &default_description
        }
    };
    let mut out = String::with_capacity(PAGE.len() + description.len() + 4 * code.len());
    let mut rest = PAGE;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let end = start + rest[start..].find("}}").expect("placeholders close") + 2;
        out.push_str(match &rest[start..end] {
            "{{code}}" => code,
            "{{code_html}}" => &code_html,
            _ => description,
        });
        rest = &rest[end..];
    }
    out.push_str(rest);
    out
}

const DEFAULT_DESCRIPTION: &str = "We encountered an unexpected error. Please try again or return to the home page. If you're a developer, you can find <a href='https://better-auth.com/docs/reference/errors/{{code}}' target='_blank' rel=\"noopener noreferrer\" style='color: var(--foreground); text-decoration: underline;'>more information about the error</a>.";

const PAGE: &str = r##"<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Error</title>
    <style>
      * {
        box-sizing: border-box;
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        background: var(--background);
        color: var(--foreground);
        margin: 0;
      }
      :root,
      :host {
        --spacing: 0.25rem;
        --container-md: 28rem;
        --text-sm: 0.875rem;
        --text-sm--line-height: calc(1.25 / 0.875);
        --text-2xl: 1.5rem;
        --text-2xl--line-height: calc(2 / 1.5);
        --text-4xl: 2.25rem;
        --text-4xl--line-height: calc(2.5 / 2.25);
        --text-6xl: 3rem;
        --text-6xl--line-height: 1;
        --font-weight-medium: 500;
        --font-weight-semibold: 600;
        --font-weight-bold: 700;
        --default-transition-duration: 150ms;
        --default-transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
        --radius: 0.625rem;
        --default-mono-font-family: var(--font-geist-mono);
        --primary: black;
        --primary-foreground: white;
        --background: white;
        --foreground: oklch(0.271 0 0);
        --border: oklch(0.89 0 0);
        --destructive: oklch(0.55 0.15 25.723);
        --muted-foreground: oklch(0.545 0 0);
        --corner-border: #404040;
      }

      button, .btn {
        cursor: pointer;
        background: none;
        border: none;
        color: inherit;
        font: inherit;
        transition: all var(--default-transition-duration)
          var(--default-transition-timing-function);
      }
      button:hover, .btn:hover {
        opacity: 0.8;
      }

      @media (prefers-color-scheme: dark) {
        :root,
        :host {
          --primary: white;
          --primary-foreground: black;
          --background: oklch(0.15 0 0);
          --foreground: oklch(0.98 0 0);
          --border: oklch(0.27 0 0);
          --destructive: oklch(0.65 0.15 25.723);
          --muted-foreground: oklch(0.65 0 0);
          --corner-border: #a0a0a0;
        }
      }
      @media (max-width: 640px) {
        :root, :host {
          --text-6xl: 2.5rem;
          --text-2xl: 1.25rem;
          --text-sm: 0.8125rem;
        }
      }
      @media (max-width: 480px) {
        :root, :host {
          --text-6xl: 2rem;
          --text-2xl: 1.125rem;
        }
      }
    </style>
  </head>
  <body style="width: 100vw; min-height: 100vh; overflow-x: hidden; overflow-y: auto;">
    <div
        style="
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 1.5rem;
            position: relative;
            width: 100%;
            min-height: 100vh;
            padding: 1rem;
        "
        >

      <div
        style="
          position: absolute;
          inset: 0;
          background-image: linear-gradient(to right, var(--border) 1px, transparent 1px),
            linear-gradient(to bottom, var(--border) 1px, transparent 1px);
          background-size: 40px 40px;
          opacity: 0.6;
          pointer-events: none;
          width: 100vw;
          height: 100vh;
        "
      ></div>
      <div
        style="
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--background);
          mask-image: radial-gradient(ellipse at center, transparent 20%, black);
          -webkit-mask-image: radial-gradient(ellipse at center, transparent 20%, black);
          pointer-events: none;
        "
      ></div>


<div
  style="
    position: relative;
    z-index: 10;
    border: 2px solid var(--border);
    background: var(--background);
    padding: 1.5rem;
    max-width: 42rem;
    width: 100%;
  "
>
    
        <!-- Corner decorations -->
        <div
          style="
            position: absolute;
            top: -2px;
            left: -2px;
            width: 2rem;
            height: 2rem;
            border-top: 4px solid var(--corner-border);
            border-left: 4px solid var(--corner-border);
          "
        ></div>
        <div
          style="
            position: absolute;
            top: -2px;
            right: -2px;
            width: 2rem;
            height: 2rem;
            border-top: 4px solid var(--corner-border);
            border-right: 4px solid var(--corner-border);
          "
        ></div>
  
        <div
          style="
            position: absolute;
            bottom: -2px;
            left: -2px;
            width: 2rem;
            height: 2rem;
            border-bottom: 4px solid var(--corner-border);
            border-left: 4px solid var(--corner-border);
          "
        ></div>
        <div
          style="
            position: absolute;
            bottom: -2px;
            right: -2px;
            width: 2rem;
            height: 2rem;
            border-bottom: 4px solid var(--corner-border);
            border-right: 4px solid var(--corner-border);
          "
        ></div>

        <div style="text-align: center; margin-bottom: 1.5rem;">
          <div style="margin-bottom: 1.5rem;">
            <div
              style="
                display: inline-block;
                border: 2px solid var(--destructive);
                padding: 0.375rem 1rem;
              "
            >
              <h1
                style="
                  font-size: var(--text-6xl);
                  font-weight: var(--font-weight-semibold);
                  color: var(--foreground);
                  letter-spacing: -0.02em;
                  margin: 0;
                "
              >
                ERROR
              </h1>
            </div>
            <div
              style="
                height: 2px;
                background-color: var(--border);
                width: calc(100% + 3rem);
                margin-left: -1.5rem;
                margin-top: 1.5rem;
              "
            ></div>
          </div>

          <h2
            style="
              font-size: var(--text-2xl);
              font-weight: var(--font-weight-semibold);
              color: var(--foreground);
              margin: 0 0 1rem;
            "
          >
            Something went wrong
          </h2>

          <div
            style="
                display: inline-flex;
                align-items: center;
                gap: 0.5rem;
                border: 2px solid var(--border);
                background-color: var(--muted);
                padding: 0.375rem 0.75rem;
                margin: 0 0 1rem;
                flex-wrap: wrap;
                justify-content: center;
            "
            >
            <span
                style="
                font-size: 0.75rem;
                color: var(--muted-foreground);
                font-weight: var(--font-weight-semibold);
                "
            >
                CODE:
            </span>
            <span
                style="
                font-size: var(--text-sm);
                font-family: var(--default-mono-font-family, monospace);
                color: var(--foreground);
                word-break: break-all;
                "
            >
                {{code_html}}
            </span>
            </div>

          <p
            style="
              color: var(--muted-foreground);
              max-width: 28rem;
              margin: 0 auto;
              font-size: var(--text-sm);
              line-height: 1.5;
              text-wrap: pretty;
            "
          >
            {{description}}
          </p>
        </div>

        <div
          style="
            display: flex;
            gap: 0.75rem;
            margin-top: 1.5rem;
            justify-content: center;
            flex-wrap: wrap;
          "
        >
          <a
            href="/"
            style="
              text-decoration: none;
            "
          >
            <div
              style="
                border: 2px solid var(--border);
                background: var(--primary);
                color: var(--primary-foreground);
                padding: 0.5rem 1rem;
                border-radius: 0;
                white-space: nowrap;
              "
              class="btn"
            >
              Go Home
            </div>
          </a>
          <a
            href="https://better-auth.com/docs/reference/errors/{{code}}?askai=What%20does%20the%20error%20code%20{{code}}%20mean%3F"
            target="_blank"
            rel="noopener noreferrer"
            style="
              text-decoration: none;
            "
          >
            <div
              style="
                border: 2px solid var(--border);
                background: transparent;
                color: var(--foreground);
                padding: 0.5rem 1rem;
                border-radius: 0;
                white-space: nowrap;
              "
              class="btn"
            >
              Ask AI
            </div>
          </a>
        </div>
      </div>
    </div>
  </body>
</html>"##;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_as_better_auth_does() {
        assert_eq!(
            sanitize(r#"<b a="1">'x' & y &amp; &#39; &#x1F; &#12; &#; &#xg; &foo;"#),
            "&lt;b a=&quot;1&quot;&gt;&#39;x&#39; &amp; y &amp; &#39; &#x1F; &#12; &amp;#; &amp;#xg; &amp;foo;"
        );
        assert_eq!(sanitize("&"), "&amp;");
        assert_eq!(sanitize("ü & ö"), "ü &amp; ö");
    }

    #[test]
    fn fills_the_code_and_description() {
        let page = page("it's", None);
        assert!(page.contains("                it&#39;s\n"));
        assert!(page.contains("errors/it's' target='_blank'"));
        assert!(page.contains("?askai=What%20does%20the%20error%20code%20it's%20mean%3F\""));
        assert!(!page.contains("{{"));
        let page = super::page("state_not_found", Some("{{code}} &lt;"));
        assert!(page.contains("            {{code}} &lt;\n"));
        assert!(!page.contains("We encountered"));
    }
}
