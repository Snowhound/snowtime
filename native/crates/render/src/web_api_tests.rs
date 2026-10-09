use super::*;

#[tokio::test(flavor = "current_thread")]
async fn encoding_and_formatting_keep_web_semantics() {
    let send: SendApi = Arc::new(|_| Box::pin(async { Err("unused API".into()) }));
    let mut renderer = Renderer::new(send, r#"{"routes":{}}"#.into(), Policy::default());
    renderer.js().execute_script("web-api-semantics.js", r#"
      function equal(actual, expected) {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error(JSON.stringify({actual, expected}));
      }
      function throws(callback, type) {
        try { callback(); } catch (error) {
          if (error instanceof type) return;
          throw error;
        }
        throw Error('Expected ' + type.name);
      }
      const encoder = new TextEncoder();
      equal([...encoder.encode('')], []);
      equal([...encoder.encode('A\u0000\u00f5\ud83d\ude00')], [65,0,195,181,240,159,152,128]);
      equal([...encoder.encode('\ud800x\udc00')], [239,191,189,120,239,191,189]);
      equal([...encoder.encode('A'.repeat(300))], Array(300).fill(65));
      equal([...encoder.encode('\u00f5'.repeat(300))], Array.from({length:300}, () => [195,181]).flat());
      equal(new TextDecoder().decode(encoder.encode('\ud83d\ude00'.repeat(300))), '\ud83d\ude00'.repeat(300));
      equal(new TextDecoder().decode(encoder.encode('\ud800'.repeat(300))), '\ufffd'.repeat(300));
      equal([...encoder.encode(undefined)], []);
      equal([...encoder.encode(null)], [110,117,108,108]);
      let conversions = 0;
      equal([...encoder.encode({toString() { conversions++; return 'a'; }})], [97]);
      equal(conversions, 1);
      throws(() => encoder.encode(Symbol()), TypeError);
      throws(() => TextEncoder.prototype.encode.call({}, 'a'), TypeError);
      throws(() => TextEncoder.prototype.encode.call(null, ''), TypeError);
      const into = new Uint8Array(3);
      equal(encoder.encodeInto('\ud83d\ude00', into), {read:0,written:0});
      equal([...into], [0,0,0]);
      equal(new TextDecoder().decode(new Uint8Array([239,187,191,97])), 'a');
      equal(new TextDecoder().decode(new Uint8Array([255])), '\ufffd');
      throws(() => new TextDecoder('utf-8', {fatal:true}).decode(new Uint8Array([255])), TypeError);

      for (const locale of ['en-US','et-EE']) {
        for (const timeZone of ['Europe/Tallinn','America/New_York']) {
          const formatter = new Intl.DateTimeFormat(locale, {timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
          const instants = [0,Date.UTC(2026,2,29,0,30),Date.UTC(2026,2,29,1,30),Date.UTC(2026,10,1,5,30),Date.UTC(2026,10,1,6,30)];
          for (const instant of instants) {
            const expected = formatter.formatToParts(new Date(instant));
            equal(formatter.formatToParts(instant), expected);
            const first = formatter.formatToParts(instant);
            first[0].value = 'changed'; first.push({type:'literal',value:'changed'});
            equal(formatter.formatToParts(instant), expected);
          }
          for (let i=0;i<300;i++) formatter.formatToParts(i * 86400000);
          equal(formatter.formatToParts(0), formatter.formatToParts(new Date(0)));
          throws(() => formatter.formatToParts(NaN), RangeError);
          throws(() => formatter.formatToParts(Infinity), RangeError);
          throws(() => Intl.DateTimeFormat.prototype.formatToParts.call({}, 0), TypeError);
          const date = new Date(0);
          equal(formatter.formatToParts(date), formatter.formatToParts(0));
          date.setUTCFullYear(2026);
          equal(formatter.formatToParts(date), formatter.formatToParts(date.getTime()));
        }
      }
    "#).unwrap();
}

// Pages reach the API only through op_send (task 081.36): no socket, DNS, TLS, or fetch op
// is registered for page JavaScript to call.
#[tokio::test(flavor = "current_thread")]
async fn no_network_op_is_registered() {
    let send: SendApi = Arc::new(|_| Box::pin(async { Err("unused API".into()) }));
    let mut renderer = Renderer::new(send, r#"{"routes":{}}"#.into(), Policy::default());
    let network = [
        "net", "fetch", "dns", "tls", "socket", "tcp", "udp", "unix", "http",
    ];
    let names = renderer.js().op_names();
    let found: Vec<_> = names
        .iter()
        .filter(|name| network.iter().any(|word| name.contains(word)))
        .collect();
    assert!(found.is_empty(), "{found:?}");
    assert!(names.contains(&"op_send"));
    renderer
        .js()
        .execute_script(
            "network.js",
            r#"
      const found = Object.keys(Deno.core.ops).filter((name) => /net|fetch|dns|tls|socket|tcp|udp|unix|http/.test(name));
      if (found.length) throw Error(found.join());
      try { fetch('https://example.com'); throw Error('fetch ran'); } catch (error) {
        if (!/setSend/.test(error.message)) throw error;
      }
      const headers = new Headers([['b', '2'], ['a', '1'], ['set-cookie', 'x'], ['set-cookie', 'y']]);
      if (JSON.stringify([...headers]) !== '[["a","1"],["b","2"],["set-cookie","x"],["set-cookie","y"]]') throw Error('headers');
      if (Response.json({ a: 1 }).headers.get('content-type') !== 'application/json') throw Error('json');
      if (Response.redirect('https://example.com/x', 307).headers.get('location') !== 'https://example.com/x') throw Error('redirect');
    "#,
        )
        .unwrap();
}
