use super::installer_detect::InstallerType;

pub(super) fn installer_arguments(
    installer_type: InstallerType,
    target: &str,
    interactive: bool,
) -> Vec<String> {
    let mut args = Vec::new();
    if !interactive {
        match installer_type {
            InstallerType::InnoSetup | InstallerType::GogInnoSetup => {
                args.extend(["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NOSOUND"].map(String::from));
            }
            InstallerType::Nsis => args.push("/S".to_string()),
            InstallerType::Msi => args.push("/qn".to_string()),
            InstallerType::Unknown => {}
        }
    }
    match installer_type {
        InstallerType::InnoSetup | InstallerType::GogInnoSetup => {
            args.push(format!("/DIR={target}"))
        }
        InstallerType::Nsis => args.push(format!("/D={target}")),
        InstallerType::Msi => args.push(format!("TARGETDIR={target}")),
        InstallerType::Unknown => {}
    }
    args
}

#[cfg(any(target_os = "windows", test))]
pub(super) fn windows_argument_line(installer_type: InstallerType, args: &[String]) -> String {
    args.iter()
        .map(|arg| {
            if installer_type == InstallerType::Nsis && arg.starts_with("/D=") {
                arg.clone()
            } else {
                quote_windows_argument(arg)
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(any(target_os = "windows", test))]
fn quote_windows_argument(arg: &str) -> String {
    if !arg.is_empty() && !arg.chars().any(|ch| ch.is_whitespace() || ch == '"') {
        return arg.to_string();
    }
    let mut quoted = String::from("\"");
    let mut slashes = 0;
    for ch in arg.chars() {
        if ch == '\\' {
            slashes += 1;
        } else {
            quoted.extend(std::iter::repeat_n(
                '\\',
                slashes * if ch == '"' { 2 } else { 1 },
            ));
            if ch == '"' {
                quoted.push('\\');
            }
            quoted.push(ch);
            slashes = 0;
        }
    }
    quoted.extend(std::iter::repeat_n('\\', slashes * 2));
    quoted.push('"');
    quoted
}
