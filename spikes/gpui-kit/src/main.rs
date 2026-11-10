//! Throwaway spike: can gpui-kit carry Claudio's UI on Linux?
//!
//! Measures cold start (process start -> first frame) and exercises a large virtualized
//! cover grid plus text inputs. See README.md for the checklist.

use std::rc::Rc;
use std::sync::OnceLock;
use std::time::Instant;

use gpui_kit::assets::Assets;
use gpui_kit::component::{
    input::{Input, InputState},
    *,
};
use gpui_kit::*;

const GAME_COUNT: usize = 5_000;
const COLUMNS: usize = 8;
const TILE_WIDTH: f32 = 150.0;
const TILE_HEIGHT: f32 = 210.0;
const ROW_GAP: f32 = 12.0;

static START: OnceLock<Instant> = OnceLock::new();

fn since_start_ms() -> f64 {
    START.get().map_or(0.0, |start| start.elapsed().as_secs_f64() * 1000.0)
}

struct Spike {
    username: Entity<InputState>,
    search: Entity<InputState>,
    scroll: VirtualListScrollHandle,
    first_render_logged: bool,
}

impl Spike {
    fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        Self {
            username: cx.new(|cx| InputState::new(window, cx).placeholder("Username")),
            search: cx.new(|cx| InputState::new(window, cx).placeholder("Search games")),
            scroll: VirtualListScrollHandle::new(),
            first_render_logged: false,
        }
    }

    fn tile(index: usize) -> impl IntoElement {
        let hue = (index as f32 * 0.618_034) % 1.0;
        v_flex()
            .w(px(TILE_WIDTH))
            .h(px(TILE_HEIGHT))
            .gap_1()
            .child(
                div()
                    .w_full()
                    .flex_1()
                    .rounded_md()
                    .bg(hsla(hue, 0.55, 0.38, 1.0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(format!("#{index}")),
            )
            .child(div().text_sm().child(format!("Game {index:05}")))
    }
}

impl Render for Spike {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if !self.first_render_logged {
            self.first_render_logged = true;
            eprintln!("first-render-ms: {:.1}", since_start_ms());
            if std::env::var_os("SPIKE_EXIT_AFTER_FIRST_RENDER").is_some() {
                cx.quit();
            }
        }

        let row_count = GAME_COUNT.div_ceil(COLUMNS);
        let row_size = size(px(TILE_WIDTH * COLUMNS as f32), px(TILE_HEIGHT + ROW_GAP));
        let row_sizes = Rc::new(vec![row_size; row_count]);

        v_flex()
            .size_full()
            .p_4()
            .gap_3()
            .child(
                h_flex()
                    .gap_3()
                    .child(div().w_64().child(Input::new(&self.username)))
                    .child(div().w_96().child(Input::new(&self.search))),
            )
            .child(
                div().flex_1().w_full().overflow_hidden().child(
                    v_virtual_list(
                        cx.entity(),
                        "cover-grid",
                        row_sizes,
                        |_, range, _, _| {
                            range
                                .map(|row| {
                                    h_flex().gap_2().pb(px(ROW_GAP)).children(
                                        (0..COLUMNS)
                                            .map(|col| row * COLUMNS + col)
                                            .filter(|index| *index < GAME_COUNT)
                                            .map(Spike::tile),
                                    )
                                })
                                .collect()
                        },
                    )
                    .track_scroll(&self.scroll)
                    .size_full(),
                ),
            )
    }
}

fn main() {
    START.get_or_init(Instant::now);

    gpui_kit::application().with_assets(Assets).run(|cx| {
        gpui_kit::init(cx);
        eprintln!("init-done-ms: {:.1}", since_start_ms());

        let options = WindowOptions {
            window_bounds: Some(WindowBounds::centered(size(px(1280.), px(800.)), cx)),
            ..Default::default()
        };
        gpui_kit::open_window(options, cx, |window, cx| cx.new(|cx| Spike::new(window, cx)))
            .expect("failed to open window");
    });
}
