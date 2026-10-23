use super::{read_open_file, FragmentReadError};
use std::fs::{self, File, OpenOptions};
use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
use std::os::windows::io::AsRawHandle;
use std::path::{Component, Path, PathBuf, Prefix};
use windows_sys::Win32::Storage::FileSystem::{
    GetFileType, FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS,
    FILE_FLAG_OPEN_REPARSE_POINT, FILE_LIST_DIRECTORY, FILE_READ_ATTRIBUTES, FILE_SHARE_READ,
    FILE_TYPE_DISK,
};

pub(super) fn read_fragment(
    data_dir: &Path,
    session_id: &str,
    file_name: &str,
) -> Result<Vec<u8>, FragmentReadError> {
    read_fragment_impl(data_dir, session_id, file_name, || {})
}

// Private seam for share/rename tests; it cannot be supplied through the RPC.
fn read_fragment_impl(
    data_dir: &Path,
    session_id: &str,
    file_name: &str,
    after_directory_pin: impl FnOnce(),
) -> Result<Vec<u8>, FragmentReadError> {
    // std canonicalize uses the native final handle path and retains the
    // extended drive/UNC prefix. Only this trusted root may resolve aliases.
    let canonical = fs::canonicalize(data_dir).map_err(|_| FragmentReadError::NotFound)?;
    let mut pins = Vec::new();
    // Pin from the volume/share root downwards, BEFORE resolving each next
    // component. Keeping just data/base/session handles would leave their
    // earlier ancestors free to be renamed or converted to junctions.
    for ancestor in directory_chain(&canonical)? {
        pins.push(open_directory(&ancestor)?);
    }
    let base = canonical.join("visualizations");
    pins.push(open_directory(&base)?);
    let session = base.join(session_id);
    pins.push(open_directory(&session)?);
    after_directory_pin();

    // All ancestors now deny write/delete sharing. Absolute resolution cannot
    // be redirected while they are held. The leaf denies those shares too,
    // including when a writable/deletable attacker handle already exists.
    let leaf = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(session.join(file_name))
        .map_err(|_| FragmentReadError::NotFound)?;
    let metadata = leaf.metadata().map_err(|_| FragmentReadError::NotFound)?;
    if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
        || !metadata.is_file()
        || !is_disk(&leaf)
    {
        return Err(FragmentReadError::NotFound);
    }
    let result = read_open_file(leaf);
    // Explicitly keep every directory capability alive THROUGH the read.
    drop(pins);
    result
}

fn open_directory(path: &Path) -> Result<File, FragmentReadError> {
    let file = OpenOptions::new()
        .read(true)
        // Attribute-only opens do not participate in Windows share-access
        // accounting. LIST_DIRECTORY (the directory READ_DATA bit) makes
        // this a real read pin that excludes existing/future writers/deleters.
        .access_mode(FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES)
        .share_mode(FILE_SHARE_READ)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|_| FragmentReadError::NotFound)?;
    let metadata = file.metadata().map_err(|_| FragmentReadError::NotFound)?;
    if !metadata.is_dir()
        || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
        || !is_disk(&file)
    {
        return Err(FragmentReadError::NotFound);
    }
    Ok(file)
}

fn is_disk(file: &File) -> bool {
    // SAFETY: File owns a live Windows handle for the duration of this call.
    unsafe { GetFileType(file.as_raw_handle()) == FILE_TYPE_DISK }
}

fn directory_chain(canonical: &Path) -> Result<Vec<PathBuf>, FragmentReadError> {
    let mut components = canonical.components();
    let prefix = match components.next() {
        Some(Component::Prefix(prefix))
            if matches!(
                prefix.kind(),
                Prefix::VerbatimDisk(_) | Prefix::VerbatimUNC(..)
            ) =>
        {
            prefix
        }
        _ => return Err(FragmentReadError::NotFound),
    };
    if components.next() != Some(Component::RootDir) {
        return Err(FragmentReadError::NotFound);
    }
    let mut current = PathBuf::from(prefix.as_os_str());
    current.push(Component::RootDir.as_os_str());
    let mut chain = vec![current.clone()];
    for component in components {
        if !matches!(component, Component::Normal(_)) {
            return Err(FragmentReadError::NotFound);
        }
        current.push(component.as_os_str());
        chain.push(current.clone());
    }
    Ok(chain)
}

#[cfg(test)]
#[path = "windows_tests.rs"]
mod tests;
