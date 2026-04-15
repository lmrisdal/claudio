use windows::Win32::System::Power::{
    SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED, EXECUTION_STATE,
};

pub(super) fn prevent_system_sleep() -> Result<(), String> {
    let state = EXECUTION_STATE(ES_CONTINUOUS.0 | ES_SYSTEM_REQUIRED.0);
    let previous = unsafe { SetThreadExecutionState(state) };
    if previous == EXECUTION_STATE(0) {
        return Err(
            "Windows refused to enable sleep prevention for an active install.".to_string(),
        );
    }

    Ok(())
}

pub(super) fn allow_system_sleep() -> Result<(), String> {
    let previous = unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
    if previous == EXECUTION_STATE(0) {
        return Err(
            "Windows refused to clear sleep prevention after install activity ended.".to_string(),
        );
    }

    Ok(())
}
