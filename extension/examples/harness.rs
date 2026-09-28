//! Dev harness: runs the extension outside Arma. Starts the server on 9800 and pushes a state
//! every 2 s (channel cycling), printing every callback that would reach SQF.
fn main() {
    let ext = tfar_sd::harness_extension();
    let port = std::env::args().nth(1).unwrap_or_else(|| "9800".into());
    println!("{:?}", ext.call("start", Some(vec![port])));
    let mut ch = 1;
    loop {
        let json = format!(r#"{{"type":"state","v":1,"inGame":true,"sw":{{"present":true,"radio":"TFAR_anprc152_1","channel":{ch},"additionalChannel":null,"frequencies":["30","31.2","45.5","50","60","70","80","90"]}}}}"#);
        let quoted = format!("\"{}\"", json.replace('"', "\"\""));
        println!("state ch={ch} -> {:?}", ext.call("state", Some(vec![quoted])));
        let _ = ext.callback_handler(
            |name, func, data| {
                println!("callback {name} {func} {data:?}");
                arma_rs::Result::<(), ()>::Continue
            },
            std::time::Duration::from_secs(2),
        );
        ch = ch % 8 + 1;
    }
}
