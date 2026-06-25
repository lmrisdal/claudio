use super::*;

pub(super) fn build_headers(
    custom_headers: &HashMap<String, String>,
) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    for (name, value) in custom_headers {
        if settings::is_forbidden_custom_header(name) {
            continue;
        }

        let header_name = HeaderName::from_bytes(name.as_bytes()).map_err(|err| err.to_string())?;
        let header_value = HeaderValue::from_str(value).map_err(|err| err.to_string())?;
        headers.insert(header_name, header_value);
    }

    Ok(headers)
}

pub(super) fn request_headers(
    custom_headers: &HashMap<String, String>,
) -> Result<HeaderMap, String>
{
    build_headers(custom_headers)
}
