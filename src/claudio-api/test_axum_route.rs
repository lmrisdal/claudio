fn main() {
    let _router = axum::Router::<()>::new().route("/api/games/{id}/emulation/files/{ticket}/*path", axum::routing::get(|| async {}));
}
