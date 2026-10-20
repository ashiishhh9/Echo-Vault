import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const jsonOutput = args.includes('--json');
const databasePath = resolve(option('--db', process.env.DATABASE_PATH || 'database/digital-time-capsule.sqlite'));
const mediaPath = resolve(option('--media', process.env.MEDIA_STORAGE_DIR || 'storage/media'));
const walkFiles = (directory) => {
  if (!existsSync(directory)) return { fileCount: 0, totalBytes: 0 };
  return readdirSync(directory, { withFileTypes: true }).reduce((summary, entry) => {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = walkFiles(entryPath);
      return { fileCount: summary.fileCount + nested.fileCount, totalBytes: summary.totalBytes + nested.totalBytes };
    }
    if (!entry.isFile()) return summary;
    return { fileCount: summary.fileCount + 1, totalBytes: summary.totalBytes + statSync(entryPath).size };
  }, { fileCount: 0, totalBytes: 0 });
};

if (!existsSync(databasePath)) {
  console.error(`Database does not exist: ${databasePath}`);
  process.exitCode = 1;
} else {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const tableReports = tables.map(({ name, sql }) => ({
    name,
    rowCount: Number(db.prepare(`SELECT COUNT(*) AS count FROM "${name.replaceAll('"', '""')}"`).get().count),
    columns: db.prepare(`PRAGMA table_info("${name.replaceAll('"', '""')}")`).all(),
    indexes: db.prepare(`PRAGMA index_list("${name.replaceAll('"', '""')}")`).all(),
    foreignKeys: db.prepare(`PRAGMA foreign_key_list("${name.replaceAll('"', '""')}")`).all(),
    createSql: sql,
  }));
  const mediaColumns = new Set(db.prepare('PRAGMA table_info("media_assets")').all().map((column) => column.name));
  const analysisStatus = mediaColumns.has('analysis_status') ? 'a.analysis_status' : 'NULL AS analysis_status';
  const mediaRows = db.prepare(`
    SELECT m.id AS memory_id, m.capsule_id, c.owner_id, c.status, a.id AS media_id,
           a.storage_key, a.mime_type, a.byte_size, ${analysisStatus}
    FROM media_assets a
    JOIN memories m ON m.id = a.memory_id
    JOIN capsules c ON c.id = m.capsule_id
    ORDER BY a.created_at, a.id
  `).all();
  const report = {
    generatedAt: new Date().toISOString(),
    databasePath,
    databaseBytes: statSync(databasePath).size,
    tables: tableReports,
    foreignKeyViolations: db.prepare('PRAGMA foreign_key_check').all(),
    media: {
      configuredPath: mediaPath,
      directoryExists: existsSync(mediaPath),
      ...walkFiles(mediaPath),
      referencedAssets: mediaRows,
      referencedAssetCount: mediaRows.length,
      referencedBytes: mediaRows.reduce((sum, row) => sum + Number(row.byte_size || 0), 0),
    },
  };
  db.close();
  if (jsonOutput) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`SQLite inventory: ${databasePath}`);
    console.log(`Database size: ${report.databaseBytes} bytes`);
    for (const table of report.tables) console.log(`- ${table.name}: ${table.rowCount} rows, ${table.columns.length} columns, ${table.indexes.length} indexes`);
    console.log(`Foreign-key violations: ${report.foreignKeyViolations.length}`);
    console.log(`Media directory: ${mediaPath} (${report.media.directoryExists ? 'exists' : 'absent'})`);
    console.log(`Media files on disk: ${report.media.fileCount}, ${report.media.totalBytes} bytes`);
    console.log(`Referenced media: ${report.media.referencedAssetCount} assets, ${report.media.referencedBytes} bytes`);
    if (report.media.referencedAssets.length) {
      for (const asset of report.media.referencedAssets) console.log(`  - ${asset.media_id}: ${asset.storage_key} (${asset.byte_size} bytes, ${asset.analysis_status})`);
    }
  }
}
