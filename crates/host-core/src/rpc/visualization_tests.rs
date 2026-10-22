//! Session visualization root (D671): containment, `.html`-only writes,
//! prompting, review exclusion, and lifecycle.

use super::*;
use std::fs;

fn options(visualization_root: Option<&Path>) -> tools::ToolExecutionOptions<'_> {
    tools::ToolExecutionOptions {
        timeout_ms: None,
        bash_options: None,
        allow_external_paths: false,
        hashline: None,
        visualization_root,
    }
}

struct Fixture {
    _data: tempfile::TempDir,
    data_dir: PathBuf,
    workspace: PathBuf,
    scratch: PathBuf,
    visualization: PathBuf,
}

fn fixture() -> Fixture {
    let data = tempfile::tempdir().unwrap();
    // Canonical paths keep the symlink-aware resolver's comparisons simple on
    // macOS, where the temp dir lives behind /var -> /private/var.
    let data_dir = fs::canonicalize(data.path()).unwrap();
    let workspace = data_dir.join("project");
    fs::create_dir_all(&workspace).unwrap();
    let scratch = scratch::session_dir(&data_dir, "s1").unwrap();
    let visualization = visualizations::session_dir(&data_dir, "s1").unwrap();
    Fixture {
        _data: data,
        data_dir,
        workspace,
        scratch,
        visualization,
    }
}

async fn run(f: &Fixture, tool: &str, args: Value) -> tools::ToolsExecuteResult {
    tools::execute_tool_with_path_access(
        Some(&f.workspace),
        Some(&f.scratch),
        tool,
        &args,
        options(Some(&f.visualization)),
    )
    .await
}

#[tokio::test]
async fn writes_and_reads_html_fragments_in_the_visualization_root() {
    let f = fixture();
    let card = f.visualization.join("chart.html");
    let written = run(
        &f,
        "Write",
        json!({ "path": card.to_string_lossy(), "content": "<p>hi</p>" }),
    )
    .await;
    assert!(written.ok, "{:?}", written.content);
    assert_eq!(written.content["root"], "visualization");
    assert_eq!(fs::read_to_string(&card).unwrap(), "<p>hi</p>");

    let read = run(&f, "Read", json!({ "path": card.to_string_lossy() })).await;
    assert!(read.ok, "{:?}", read.content);
    assert_eq!(read.content["root"], "visualization");
}

#[tokio::test]
async fn rejects_non_html_writes_in_the_visualization_root() {
    let f = fixture();
    let script = f.visualization.join("evil.js");
    let written = run(
        &f,
        "Write",
        json!({ "path": script.to_string_lossy(), "content": "x" }),
    )
    .await;
    assert!(!written.ok);
    assert_eq!(
        written.error_code.as_deref(),
        Some("VISUALIZATION_HTML_ONLY")
    );
    assert!(!script.exists());

    // Nested paths are unreachable by the card URL, so they are refused too.
    let nested = f.visualization.join("sub").join("chart.html");
    let nested_write = run(
        &f,
        "Write",
        json!({ "path": nested.to_string_lossy(), "content": "<p>x</p>" }),
    )
    .await;
    assert_eq!(
        nested_write.error_code.as_deref(),
        Some("VISUALIZATION_HTML_ONLY")
    );
    assert!(!nested.exists());

    // Scratch keeps accepting any extension.
    let note = f.scratch.join("notes.txt");
    let scratch_write = run(
        &f,
        "Write",
        json!({ "path": note.to_string_lossy(), "content": "x" }),
    )
    .await;
    assert!(scratch_write.ok, "{:?}", scratch_write.content);
    assert_eq!(scratch_write.content["root"], "scratch");
}

#[tokio::test]
async fn rejects_dotdot_and_symlink_escapes_from_the_visualization_root() {
    let f = fixture();
    let escape = format!("{}/../../outside.html", f.visualization.to_string_lossy());
    let dotdot = run(&f, "Write", json!({ "path": escape, "content": "x" })).await;
    assert!(!dotdot.ok);
    assert!(!f.data_dir.join("outside.html").exists());

    #[cfg(unix)]
    {
        let outside = f.data_dir.join("elsewhere");
        fs::create_dir_all(&outside).unwrap();
        fs::create_dir_all(&f.visualization).unwrap();
        std::os::unix::fs::symlink(&outside, f.visualization.join("link")).unwrap();
        let through_link = f.visualization.join("link").join("x.html");
        let linked = run(
            &f,
            "Write",
            json!({ "path": through_link.to_string_lossy(), "content": "x" }),
        )
        .await;
        assert!(!linked.ok);
        assert!(!outside.join("x.html").exists());
    }
}

#[test]
fn visualization_writes_skip_prompts_except_remote_and_contract_modes() {
    let f = fixture();
    let roots = local_contained_roots(&f.data_dir, "s1", false);
    let args = json!({ "path": f.visualization.join("a.html").to_string_lossy() });
    assert!(contained_write_auto_allowed(
        false, "agent", &roots, "Write", &args
    ));
    assert!(contained_write_auto_allowed(
        false, "agent", &roots, "Edit", &args
    ));
    assert!(!contained_write_auto_allowed(
        false, "plan", &roots, "Write", &args
    ));
    assert!(!contained_write_auto_allowed(
        false, "goal", &roots, "Write", &args
    ));
    assert!(!contained_write_auto_allowed(
        true, "agent", &roots, "Write", &args
    ));
    assert!(!contained_write_auto_allowed(
        false, "agent", &roots, "Bash", &args
    ));
    let workspace_args = json!({ "path": "notes.txt" });
    assert!(!contained_write_auto_allowed(
        false,
        "agent",
        &roots,
        "Write",
        &workspace_args
    ));
}

#[test]
fn remote_sessions_get_no_visualization_root() {
    let f = fixture();
    let remote = local_contained_roots(&f.data_dir, "s1", true);
    let path = f.visualization.join("a.html");
    assert!(remote.lexical_root(&path.to_string_lossy()).is_none());
    let local = local_contained_roots(&f.data_dir, "s1", false);
    assert_eq!(
        local
            .lexical_root(&path.to_string_lossy())
            .map(|root| root.kind),
        Some(ToolRoot::Visualization)
    );
}

#[test]
fn visualization_paths_do_not_require_external_path_permission() {
    let f = fixture();
    let roots = local_contained_roots(&f.data_dir, "s1", false);
    let workspace = f.workspace.to_string_lossy().to_string();
    let inside = json!({ "path": f.visualization.join("a.html").to_string_lossy() });
    assert!(!requires_external_path_permission(
        Some(&workspace),
        &roots,
        "Read",
        &inside
    ));
    assert!(!requires_external_path_permission(
        Some(&workspace),
        &roots,
        "Write",
        &inside
    ));
    let other_session = visualizations::session_dir(&f.data_dir, "s2").unwrap();
    let foreign = json!({ "path": other_session.join("a.html").to_string_lossy() });
    assert!(requires_external_path_permission(
        Some(&workspace),
        &roots,
        "Write",
        &foreign
    ));
}

#[test]
fn visualization_writes_are_not_review_snapshotted() {
    let f = fixture();
    let roots = local_contained_roots(&f.data_dir, "s1", false);
    let pending = review::prepare_change(
        &f.data_dir,
        "s1",
        "call-1",
        Some(&f.workspace),
        &roots,
        "Write",
        &json!({ "path": f.visualization.join("a.html").to_string_lossy() }),
    )
    .unwrap();
    assert!(pending.is_none());
}

#[test]
fn deleting_session_side_data_removes_its_visualizations() {
    let data = tempfile::tempdir().unwrap();
    let state = AppState::open(data.path()).unwrap();
    let dir = visualizations::session_dir(&state.data_dir, "gone").unwrap();
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("a.html"), "<p></p>").unwrap();
    let kept = visualizations::session_dir(&state.data_dir, "kept").unwrap();
    fs::create_dir_all(&kept).unwrap();
    drop_session_side_data(&state, "gone");
    assert!(!dir.exists());
    assert!(kept.exists());
}

#[test]
fn moving_a_fragment_out_of_contained_roots_needs_a_prompt() {
    let f = fixture();
    let roots = local_contained_roots(&f.data_dir, "s1", false);
    let path = f.visualization.join("a.html");
    let ops_for = |dest: &str| format!("[{}#AAAA]\nMV {dest}\n", path.display());
    let to_workspace = json!({ "path": path.to_string_lossy(), "ops": ops_for("src/main.rs") });
    assert!(!contained_write_auto_allowed(
        false,
        "agent",
        &roots,
        "Edit",
        &to_workspace
    ));
    let inside = f.visualization.join("b.html");
    let within = json!({
        "path": path.to_string_lossy(),
        "ops": ops_for(&inside.to_string_lossy()),
    });
    assert!(contained_write_auto_allowed(
        false, "agent", &roots, "Edit", &within
    ));
}

#[tokio::test]
async fn visualization_rules_apply_when_the_workspace_contains_the_data_dir() {
    let f = fixture();
    let roots = local_contained_roots(&f.data_dir, "s1", false);
    let nested = f.visualization.join("nested").join("x.html");
    let resolved = workspace::resolve_tool_path(&f.data_dir, &roots, &nested.to_string_lossy());
    assert!(
        resolved.is_err() || resolved.as_ref().unwrap().1 == ToolRoot::Visualization,
        "visualization paths must not resolve as workspace: {resolved:?}"
    );
    let result = tools::execute_tool_with_path_access(
        Some(&f.data_dir),
        Some(&f.scratch),
        "Write",
        &json!({ "path": f.visualization.join("notes.txt").to_string_lossy(), "content": "x" }),
        options(Some(&f.visualization)),
    )
    .await;
    assert!(!result.ok, "non-html write must be rejected: {result:?}");
    assert!(!f.visualization.join("notes.txt").exists());
}
