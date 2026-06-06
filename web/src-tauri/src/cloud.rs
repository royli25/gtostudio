use std::io::Write;

/// Upload the solved tree to Supabase Storage and upsert the spot record.
pub fn upload_pipeline(
    supabase_url: &str,
    anon_key: &str,
    nodes_json: &str,
    spot_metadata: Option<&serde_json::Value>,
) -> Result<String, String> {
    // 1. Compress with gzip
    let compressed = compress_gzip(nodes_json.as_bytes())?;

    // 2. Generate spot ID from metadata
    let spot_id = spot_metadata
        .and_then(|m| m.get("configHash").and_then(|v| v.as_str()))
        .unwrap_or("unknown")
        .to_string();

    let path = format!("trees/{spot_id}.json.gz");

    // 3. Upload to Supabase Storage
    upload_to_storage(supabase_url, anon_key, &path, &compressed)?;

    // 4. Upsert spot record via PostgREST
    if let Some(metadata) = spot_metadata {
        upsert_spot(supabase_url, anon_key, metadata, &path)?;
    }

    Ok(spot_id)
}

fn compress_gzip(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(data).map_err(|e| e.to_string())?;
    encoder.finish().map_err(|e| e.to_string())
}

fn upload_to_storage(
    supabase_url: &str,
    anon_key: &str,
    path: &str,
    data: &[u8],
) -> Result<(), String> {
    let url = format!("{}/storage/v1/object/solutions/{}", supabase_url, path);
    let client = reqwest::blocking::Client::new();
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", anon_key))
        .header("apikey", anon_key)
        .header("Content-Type", "application/gzip")
        .header("x-upsert", "true")
        .body(data.to_vec())
        .send()
        .map_err(|e| format!("Storage upload failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().unwrap_or_default();
        return Err(format!("Storage upload failed ({status}): {body}"));
    }
    Ok(())
}

fn upsert_spot(
    supabase_url: &str,
    anon_key: &str,
    metadata: &serde_json::Value,
    tree_path: &str,
) -> Result<(), String> {
    let url = format!("{}/rest/v1/solved_spots", supabase_url);

    // Build the row from metadata, adding tree_path and updated_at
    let mut row = metadata.clone();
    if let Some(obj) = row.as_object_mut() {
        obj.insert(
            "tree_path".into(),
            serde_json::Value::String(tree_path.to_string()),
        );
        obj.insert(
            "updated_at".into(),
            serde_json::Value::String(chrono::Utc::now().to_rfc3339()),
        );
    }

    let client = reqwest::blocking::Client::new();
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", anon_key))
        .header("apikey", anon_key)
        .header("Content-Type", "application/json")
        .header("Prefer", "resolution=merge-duplicates")
        .body(row.to_string())
        .send()
        .map_err(|e| format!("PostgREST upsert failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().unwrap_or_default();
        return Err(format!("PostgREST upsert failed ({status}): {body}"));
    }
    Ok(())
}
