/**
 * pdf-engine API client
 * Talks to the FastAPI service that stamps barcodes onto hall ticket PDFs.
 */

const BASE_URL = process.env.NEXT_PUBLIC_PDF_ENGINE_URL ?? "http://localhost:8000";

export type JobStatus = "processing" | "done" | "error";

export interface StatusResponse {
    job_id: string;
    status: JobStatus;
    total_pages: number;
    processed_pages: number;
    barcode_success: number;
    barcode_failed: number;
    error_message: string;
    filename: string;
}

export interface ResultResponse {
    download_url: string;
    filename: string;
}

/** Step 1 — ask the backend for a presigned upload URL */
export async function requestUploadUrl(
    filename: string,
): Promise<{ job_id: string; object_key: string; upload_url: string }> {
    const res = await fetch(`${BASE_URL}/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename }),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`upload-url failed (${res.status}): ${text}`);
    }
    return res.json();
}

/** Step 2 — PUT the file directly to Supabase S3 via the presigned URL */
export async function uploadFileDirect(
    uploadUrl: string,
    file: File,
    onProgress?: (pct: number) => void,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", "application/pdf");
        if (onProgress) {
            xhr.upload.addEventListener("progress", (e) => {
                if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
            });
        }
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.send(file);
    });
}

/** Step 3 — tell the backend to start processing */
export async function startProcessing(
    job_id: string,
    object_key: string,
    filename: string,
): Promise<void> {
    const res = await fetch(`${BASE_URL}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id, object_key, filename }),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`process failed (${res.status}): ${text}`);
    }
}

/** Poll job status */
export async function getStatus(job_id: string): Promise<StatusResponse> {
    const res = await fetch(`${BASE_URL}/status/${job_id}`);
    if (!res.ok) throw new Error(`status failed (${res.status})`);
    return res.json();
}

/** Get signed download URL for the finished PDF */
export async function getResult(job_id: string): Promise<ResultResponse> {
    const res = await fetch(`${BASE_URL}/result/${job_id}`);
    if (!res.ok) throw new Error(`result failed (${res.status})`);
    return res.json();
}

/** Health check — true if the backend is reachable and healthy */
export async function checkBackend(timeoutMs = 5000): Promise<boolean> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(`${BASE_URL}/health`, { signal: controller.signal });
        if (!res.ok) return false;
        const data = (await res.json()) as { status?: string; redis?: string };
        return data?.status === "ok" && data?.redis === "ok";
    } catch {
        return false;
    } finally {
        clearTimeout(t);
    }
}
