fn main() {
    let parsed = url::Url::parse("claudio://auth/callback").unwrap();
    println!("scheme: {}", parsed.scheme());
    println!("host: {:?}", parsed.host_str());
    println!("path: {}", parsed.path());
}
