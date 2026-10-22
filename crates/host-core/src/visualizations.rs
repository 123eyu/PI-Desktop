//! Per-session visualization directories (D671).
//!
//! Inline GenUI cards are HTML fragments the agent writes under
//! `<data_dir>/visualizations/<session_id>/`; the desktop serves them through
//! the sandboxed `pi-genui:` protocol. Unlike scratch, these files are part of
//! the transcript: they are never removed by age, only together with their
//! session (or by the startup sweep once the session no longer exists).
//! Created lazily on the first Write/Edit that targets the directory.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// Session ids come from our own DB (UUIDs), but stay defensive: an id that
/// could traverse out of the base directory gets no directory at all.
fn safe_session_id(session_id: &str) -> bool {
    !session_id.is_empty()
        && session_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn base_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("visualizations")
}

/// Absolute visualization directory for a session, or None for unsafe ids.
pub fn session_dir(data_dir: &Path, session_id: &str) -> Option<PathBuf> {
    if !safe_session_id(session_id) {
        return None;
    }
    Some(base_dir(data_dir).join(session_id))
}

/// True when `path` names an `.html` file (lowercase `.html` only).
pub fn is_fragment_path(path: &Path) -> bool {
    // Mirrors `isGenUiFileName` in packages/shared/src/gen-ui.ts.
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let Some(stem) = name.strip_suffix(".html") else {
        return false;
    };
    let mut chars = stem.chars();
    stem.len() <= 128
        && !name.contains("..")
        && chars.next().is_some_and(|c| c.is_ascii_alphanumeric())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// Remove a session's visualization directory (idempotent, best-effort).
pub fn remove_session_dir(data_dir: &Path, session_id: &str) {
    if let Some(dir) = session_dir(data_dir, session_id) {
        if dir.exists() {
            if let Err(error) = std::fs::remove_dir_all(&dir) {
                tracing::warn!(path = %dir.display(), %error, "visualization cleanup failed");
            }
        }
    }
}

/// Startup sweep: drop directories whose session no longer exists. Live
/// sessions keep their cards regardless of age — the transcript still
/// references them.
pub fn sweep(data_dir: &Path, live_session_ids: &HashSet<String>) {
    let base = base_dir(data_dir);
    let Ok(entries) = std::fs::read_dir(&base) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        // Do not follow symlinks out of the base directory.
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if !is_dir {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if live_session_ids.contains(&name) {
            continue;
        }
        if let Err(error) = std::fs::remove_dir_all(&path) {
            tracing::warn!(path = %path.display(), %error, "visualization sweep failed");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime};
    use tempfile::tempdir;

    #[test]
    fn rejects_unsafe_session_ids() {
        let dir = tempdir().unwrap();
        assert!(session_dir(dir.path(), "../evil").is_none());
        assert!(session_dir(dir.path(), "a/b").is_none());
        assert!(session_dir(dir.path(), "").is_none());
        assert_eq!(
            session_dir(dir.path(), "0b0e9a52-1_ok").unwrap(),
            dir.path().join("visualizations").join("0b0e9a52-1_ok")
        );
    }

    #[test]
    fn fragment_paths_require_html_extension() {
        assert!(is_fragment_path(Path::new("/x/chart.html")));
        assert!(!is_fragment_path(Path::new("/x/Chart.HTML")));
        assert!(!is_fragment_path(Path::new("/x/.hidden.html")));
        assert!(!is_fragment_path(Path::new("/x/a..b.html")));
        assert!(is_fragment_path(Path::new("/x/chart-v2_final.html")));
        assert!(!is_fragment_path(Path::new("/x/chart.htm")));
        assert!(!is_fragment_path(Path::new("/x/chart.js")));
        assert!(!is_fragment_path(Path::new("/x/html")));
    }

    #[test]
    fn remove_is_idempotent() {
        let dir = tempdir().unwrap();
        let s = session_dir(dir.path(), "s1").unwrap();
        std::fs::create_dir_all(&s).unwrap();
        std::fs::write(s.join("a.html"), "<p>x</p>").unwrap();
        remove_session_dir(dir.path(), "s1");
        assert!(!s.exists());
        remove_session_dir(dir.path(), "s1");
    }

    #[test]
    fn sweep_removes_orphans_and_keeps_live_regardless_of_age() {
        let dir = tempdir().unwrap();
        let live = session_dir(dir.path(), "live").unwrap();
        let orphan = session_dir(dir.path(), "orphan").unwrap();
        std::fs::create_dir_all(&live).unwrap();
        std::fs::create_dir_all(&orphan).unwrap();
        let card = live.join("old.html");
        std::fs::write(&card, "<p>old</p>").unwrap();
        let ancient = SystemTime::now() - Duration::from_secs(365 * 24 * 60 * 60);
        std::fs::File::options()
            .write(true)
            .open(&card)
            .unwrap()
            .set_modified(ancient)
            .unwrap();
        std::fs::File::open(&live)
            .unwrap()
            .set_modified(ancient)
            .ok();
        let mut ids = HashSet::new();
        ids.insert("live".to_string());
        sweep(dir.path(), &ids);
        assert!(card.exists());
        assert!(!orphan.exists());
    }
}
