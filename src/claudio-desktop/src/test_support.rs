use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

#[derive(Clone, Debug)]
pub struct TestRequest {
    pub method: String,
    pub path: String,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

#[derive(Clone, Debug)]
pub struct TestResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl TestResponse {
    pub fn json(status: u16, body: &str) -> Self {
        Self {
            status,
            headers: vec![("content-type".to_string(), "application/json".to_string())],
            body: body.as_bytes().to_vec(),
        }
    }

    pub fn text(status: u16, body: &str) -> Self {
        Self {
            status,
            headers: vec![(
                "content-type".to_string(),
                "text/plain; charset=utf-8".to_string(),
            )],
            body: body.as_bytes().to_vec(),
        }
    }
}

pub struct TestServer {
    url: String,
    #[allow(dead_code)]
    requests: Arc<Mutex<Vec<TestRequest>>>,
    stop: Arc<AtomicBool>,
    handle: Option<thread::JoinHandle<()>>,
}

impl TestServer {
    pub fn spawn(handler: impl Fn(TestRequest) -> TestResponse + Send + Sync + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("test server should bind");
        let address = listener
            .local_addr()
            .expect("test server should have address");
        let url = format!("http://{}", address);
        let requests = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let requests_for_thread = requests.clone();
        let stop_for_thread = stop.clone();
        let handler = Arc::new(handler);
        let handle = thread::spawn(move || {
            while !stop_for_thread.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        if stop_for_thread.load(Ordering::SeqCst) {
                            break;
                        }
                        if let Ok(request) = read_request(&mut stream) {
                            if let Ok(mut captured) = requests_for_thread.lock() {
                                captured.push(request.clone());
                            }
                            let response = handler(request);
                            let _ = write_response(&mut stream, response);
                        }
                    }
                    Err(_) => {
                        break;
                    }
                }
            }
        });

        Self {
            url,
            requests,
            stop,
            handle: Some(handle),
        }
    }

    pub fn url(&self) -> &str {
        &self.url
    }

    #[allow(dead_code)]
    pub fn requests(&self) -> Vec<TestRequest> {
        self.requests
            .lock()
            .expect("requests lock should not be poisoned")
            .clone()
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(self.url.trim_start_matches("http://"));
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

fn read_request(stream: &mut TcpStream) -> Result<TestRequest, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|error| error.to_string())?;

    let mut buffer = Vec::new();
    let mut headers_end = None;
    let mut temp = [0_u8; 1024];

    while headers_end.is_none() {
        let read = stream.read(&mut temp).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&temp[..read]);
        headers_end = find_headers_end(&buffer);
    }

    let headers_end = headers_end.ok_or_else(|| "Malformed HTTP request.".to_string())?;
    let head =
        String::from_utf8(buffer[..headers_end].to_vec()).map_err(|error| error.to_string())?;
    let mut lines = head.split("\r\n");
    let request_line = lines
        .next()
        .ok_or_else(|| "Missing request line.".to_string())?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or_else(|| "Missing method.".to_string())?
        .to_string();
    let path = request_parts
        .next()
        .ok_or_else(|| "Missing path.".to_string())?
        .to_string();

    let mut headers = HashMap::new();
    for line in lines.filter(|line| !line.is_empty()) {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    let mut body = buffer[(headers_end + 4)..].to_vec();
    while body.len() < content_length {
        let read = stream.read(&mut temp).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&temp[..read]);
    }
    body.truncate(content_length);

    Ok(TestRequest {
        method,
        path,
        headers,
        body,
    })
}

fn write_response(stream: &mut TcpStream, response: TestResponse) -> Result<(), String> {
    let status_text = match response.status {
        200 => "OK",
        201 => "Created",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        502 => "Bad Gateway",
        _ => "OK",
    };

    let mut head = format!(
        "HTTP/1.1 {} {}\r\nContent-Length: {}\r\n",
        response.status,
        status_text,
        response.body.len()
    );
    for (name, value) in response.headers {
        head.push_str(&format!("{}: {}\r\n", name, value));
    }
    head.push_str("Connection: close\r\n\r\n");

    stream
        .write_all(head.as_bytes())
        .and_then(|_| stream.write_all(&response.body))
        .map_err(|error| error.to_string())
}

fn find_headers_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}
