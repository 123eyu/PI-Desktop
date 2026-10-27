use super::{create_migration_backup, Connection, Context, Path, Result};
use rusqlite::Transaction;

/// v26 stores the per-session `/fast` switch (ADR 0334). Every existing
/// session keeps the default service tier.
fn migrate_v25_to_v26_tx(tx: &Transaction<'_>) -> Result<()> {
    let has_fast_mode: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM pragma_table_info('sessions') WHERE name = 'fast_mode')",
        [],
        |row| row.get(0),
    )?;
    if !has_fast_mode {
        tx.execute_batch(
            "ALTER TABLE sessions ADD COLUMN fast_mode INTEGER NOT NULL DEFAULT 0
             CHECK (fast_mode IN (0, 1));",
        )?;
    }
    tx.pragma_update(None, "user_version", 26i64)?;
    Ok(())
}

pub(crate) fn migrate_v25_to_v26(conn: &Connection, path: &Path) -> Result<()> {
    let backup = create_migration_backup(conn, path, 25)?;
    let tx = conn.unchecked_transaction()?;
    migrate_v25_to_v26_tx(&tx)?;
    tx.commit().with_context(|| {
        format!(
            "commit schema v25 to v26 migration; backup {} remains",
            backup.display()
        )
    })?;
    Ok(())
}
