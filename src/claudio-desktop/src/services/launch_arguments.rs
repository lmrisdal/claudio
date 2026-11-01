pub fn parse(parameters: &str) -> Result<Vec<String>, String> {
    let mut arguments = Vec::new();
    let mut argument = String::new();
    let mut quote = None;
    let mut started = false;
    let mut chars = parameters.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '\\' if quote != Some('\'')
                && chars.peek().is_some_and(|next| {
                    *next == '"' || *next == '\\' || (quote.is_none() && next.is_whitespace())
                }) =>
            {
                if let Some(next) = chars.next() {
                    argument.push(next);
                }
                started = true;
            }
            '\'' | '"' if quote.is_none() => {
                quote = Some(ch);
                started = true;
            }
            ch if quote == Some(ch) => quote = None,
            ch if ch.is_whitespace() && quote.is_none() => {
                if started {
                    arguments.push(std::mem::take(&mut argument));
                    started = false;
                }
            }
            ch => {
                argument.push(ch);
                started = true;
            }
        }
    }
    if quote.is_some() {
        return Err("Launch parameters contain an unclosed quote.".to_string());
    }
    if started {
        arguments.push(argument);
    }
    Ok(arguments)
}

#[cfg(test)]
mod tests {
    use super::parse;

    #[test]
    fn preserves_quoted_arguments_and_literal_shell_characters() {
        assert_eq!(
            parse(r#"-name "Player One" '' $HOME ; C:\games\save"#),
            Ok(vec![
                "-name".into(),
                "Player One".into(),
                "".into(),
                "$HOME".into(),
                ";".into(),
                r"C:\games\save".into()
            ])
        );
    }

    #[test]
    fn rejects_unclosed_quotes() {
        assert!(parse("-name \"Player").is_err());
    }
}
