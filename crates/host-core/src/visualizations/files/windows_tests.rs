use super::super::tests::{fixture, FILE_NAME, ORIGINAL, SESSION, VICTIM};
use super::super::{read_fragment, FragmentReadError};
use super::{directory_chain, read_fragment_impl};
use std::fs::{self, File, OpenOptions};
use std::os::windows::fs::{symlink_file, OpenOptionsExt};
use std::path::{Component, Path, PathBuf, Prefix};
use std::process::Command;
use windows_sys::Win32::Foundation::ERROR_SHARING_VIOLATION;
use windows_sys::Win32::Storage::FileSystem::{
    FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE, FILE_SHARE_READ,
    FILE_SHARE_WRITE, FILE_WRITE_DATA,
};

fn junction(link: &Path, target: &Path) {
    // Junctions need no symlink privilege. Both paths are controlled fixtures;
    // quoting protects spaces in the Windows temporary directory.
    let command = format!("mklink /J \"{}\" \"{}\"", link.display(), target.display());
    let output = Command::new("cmd")
        .args(["/D", "/C", &command])
        .output()
        .expect("create test junction");
    assert!(
        output.status.success(),
        "junction creation failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn open_writable_directory(path: &Path) -> std::io::Result<File> {
    OpenOptions::new()
        .write(true)
        .access_mode(FILE_WRITE_DATA)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
}

#[test]
fn extended_drive_and_unc_paths_keep_their_root_components() {
    assert_eq!(
        directory_chain(Path::new(r"\\?\C:\Users\example\data")).expect("drive chain"),
        [
            PathBuf::from(r"\\?\C:\"),
            PathBuf::from(r"\\?\C:\Users"),
            PathBuf::from(r"\\?\C:\Users\example"),
            PathBuf::from(r"\\?\C:\Users\example\data"),
        ]
    );
    assert_eq!(
        directory_chain(Path::new(r"\\?\UNC\server\share\data")).expect("UNC chain"),
        [
            PathBuf::from(r"\\?\UNC\server\share\"),
            PathBuf::from(r"\\?\UNC\server\share\data"),
        ]
    );
    for path in [
        r"C:\data",
        r"C:data",
        r"\\.\pipe\data",
        r"\\?\C:\data\..\other",
    ] {
        assert_eq!(
            directory_chain(Path::new(path)),
            Err(FragmentReadError::NotFound)
        );
    }
}

#[test]
fn reads_canonical_drive_path_and_allows_trusted_data_junction_alias() {
    let fixture = fixture();
    let canonical = fs::canonicalize(&fixture.data).expect("canonical data");
    assert!(matches!(
        canonical.components().next(),
        Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::VerbatimDisk(_) | Prefix::VerbatimUNC(..))
    ));
    assert_eq!(
        read_fragment(&canonical, SESSION, FILE_NAME),
        Ok(ORIGINAL.to_vec())
    );
    let alias = fixture.temp.path().join("data-alias");
    junction(&alias, &fixture.data);
    assert_eq!(
        read_fragment(&alias, SESSION, FILE_NAME),
        Ok(ORIGINAL.to_vec())
    );
    fs::remove_dir(alias).expect("remove data junction");
}

#[test]
fn rejects_visualization_base_junction_even_to_original_base() {
    let fixture = fixture();
    let base = fixture.data.join("visualizations");
    let held = fixture.data.join("held-base");
    fs::rename(&base, &held).expect("move base");
    junction(&base, &held);
    assert_eq!(
        read_fragment(&fixture.data, SESSION, FILE_NAME),
        Err(FragmentReadError::NotFound)
    );
    fs::remove_dir(base).expect("remove base junction");
}

#[test]
fn rejects_same_root_session_junction_alias() {
    let fixture = fixture();
    let victim = fixture.data.join("visualizations").join("session-B");
    fs::create_dir(&victim).expect("victim session");
    fs::write(victim.join(FILE_NAME), VICTIM).expect("victim fragment");
    let held = fixture.session.with_file_name("held-session");
    fs::rename(&fixture.session, &held).expect("move session");
    junction(&fixture.session, &victim);
    assert_eq!(
        read_fragment(&fixture.data, SESSION, FILE_NAME),
        Err(FragmentReadError::NotFound)
    );
    fs::remove_dir(&fixture.session).expect("remove session junction");
}

#[test]
fn rejects_reparse_leaf_and_file_symlink_when_privilege_is_available() {
    let fixture = fixture();
    let leaf = fixture.session.join(FILE_NAME);
    fs::remove_file(&leaf).expect("remove original leaf");
    junction(&leaf, fixture.temp.path());
    assert_eq!(
        read_fragment(&fixture.data, SESSION, FILE_NAME),
        Err(FragmentReadError::NotFound)
    );
    fs::remove_dir(&leaf).expect("remove leaf junction");
    let victim = fixture.temp.path().join("victim.html");
    fs::write(&victim, VICTIM).expect("victim fragment");
    match symlink_file(&victim, &leaf) {
        Ok(()) => assert_eq!(
            read_fragment(&fixture.data, SESSION, FILE_NAME),
            Err(FragmentReadError::NotFound)
        ),
        Err(error) if error.raw_os_error() == Some(1314) => {
            eprintln!("file symlink assertion skipped: Windows symlink privilege is unavailable");
        }
        Err(error) => panic!("create leaf symlink: {error}"),
    }
}

#[test]
fn pins_data_ancestors_base_and_session_until_read_completes() {
    let fixture = fixture();
    let base = fixture.data.join("visualizations");
    let paths = [
        fixture.temp.path(),
        fixture.data.as_path(),
        base.as_path(),
        fixture.session.as_path(),
    ];
    // Establish that write access is allowed without our share pins.
    for path in paths {
        drop(open_writable_directory(path).expect("unpinned writable directory"));
    }
    let result = read_fragment_impl(&fixture.data, SESSION, FILE_NAME, || {
        for path in paths {
            let replacement = path.with_file_name("rename-attempt");
            assert!(
                fs::rename(path, &replacement).is_err(),
                "pinned ancestor cannot be renamed"
            );
            let error =
                open_writable_directory(path).expect_err("pinned ancestor cannot be modified");
            assert_eq!(error.raw_os_error(), Some(ERROR_SHARING_VIOLATION as i32));
        }
    });
    assert_eq!(result, Ok(ORIGINAL.to_vec()));
    for path in paths {
        drop(open_writable_directory(path).expect("directory pin released"));
    }
    let held = fixture.session.with_file_name("renamed-after-read");
    fs::rename(&fixture.session, &held).expect("session pin released");
    fs::rename(&held, &fixture.session).expect("restore session");
}

#[test]
fn refuses_preexisting_write_or_delete_directory_handles() {
    let fixture = fixture();
    let writable =
        open_writable_directory(&fixture.session).expect("existing writable session handle");
    assert_eq!(
        read_fragment(&fixture.data, SESSION, FILE_NAME),
        Err(FragmentReadError::NotFound)
    );
    drop(writable);
    let deletion = OpenOptions::new()
        .read(true)
        .access_mode(windows_sys::Win32::Storage::FileSystem::DELETE)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(&fixture.data)
        .expect("existing deletable data handle");
    assert_eq!(
        read_fragment(&fixture.data, SESSION, FILE_NAME),
        Err(FragmentReadError::NotFound)
    );
    drop(deletion);
    assert_eq!(
        read_fragment(&fixture.data, SESSION, FILE_NAME),
        Ok(ORIGINAL.to_vec())
    );
}

#[test]
fn refuses_preexisting_writable_leaf_and_releases_handles_on_error() {
    let fixture = fixture();
    let writable = OpenOptions::new()
        .write(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .open(fixture.session.join(FILE_NAME))
        .expect("existing writable leaf");
    assert_eq!(
        read_fragment(&fixture.data, SESSION, FILE_NAME),
        Err(FragmentReadError::NotFound)
    );
    drop(writable);
    assert_eq!(
        read_fragment(&fixture.data, SESSION, FILE_NAME),
        Ok(ORIGINAL.to_vec())
    );
    let held = fixture.data.with_file_name("data-after-error");
    fs::rename(&fixture.data, &held).expect("all ancestor pins released");
    fs::rename(&held, &fixture.data).expect("restore data");
}
