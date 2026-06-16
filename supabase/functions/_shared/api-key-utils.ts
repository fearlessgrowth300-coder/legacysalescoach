let cachedDecryptionKey: Promise<CryptoKey> | null = null;

async function getDecryptionKey(): Promise<CryptoKey> {
  if (!cachedDecryptionKey) {
    cachedDecryptionKey = (async () => {
      const encryptionSeed = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!encryptionSeed) throw new Error("Missing encryption seed");

      const keyMaterial = new TextEncoder().encode(encryptionSeed);
      const hash = await crypto.subtle.digest("SHA-256", keyMaterial);
      return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["decrypt"]);
    })();
  }

  return cachedDecryptionKey;
}

function hexToBytes(value: string): Uint8Array {
  const parts = value.match(/.{2}/g);
  if (!parts) return new Uint8Array();
  return Uint8Array.from(parts.map((part) => parseInt(part, 16)));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function decryptStoredApiKey(storedValue: string): Promise<string> {
  const trimmedValue = storedValue.trim();
  if (!trimmedValue.startsWith("enc:")) return trimmedValue;

  const [, ivHex, ciphertextHex] = trimmedValue.split(":");
  if (!ivHex || !ciphertextHex) throw new Error("Invalid encrypted API key format");

  const key = await getDecryptionKey();
  const iv = toArrayBuffer(hexToBytes(ivHex));
  const ciphertext = toArrayBuffer(hexToBytes(ciphertextHex));
  const plainBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );

  return new TextDecoder().decode(plainBuffer).trim();
}

export function describeApiKey(key: string | null | undefined) {
  if (!key) {
    return { length: 0, prefix: "", suffix: "" };
  }

  return {
    length: key.length,
    prefix: key.slice(0, 4),
    suffix: key.slice(-4),
  };
}

export async function getLatestUserApiKey(
  supabase: any,
  userId: string | null,
  services: string[],
): Promise<{ key: string; service: string } | null> {
  if (!userId) return null;

  const { data, error } = await supabase
    .from("user_api_keys")
    .select("api_key, service")
    .eq("user_id", userId)
    .in("service", services)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data?.api_key) return null;

  return {
    key: await decryptStoredApiKey(data.api_key),
    service: data.service,
  };
}

// Returns ALL keys for the user across the given services, ordered newest first.
// Used to rotate through multiple keys (e.g. several YouTube Transcript keys).
export async function getAllUserApiKeys(
  supabase: any,
  userId: string | null,
  services: string[],
): Promise<{ id: string; key: string; service: string; label: string }[]> {
  if (!userId) return [];
  const { data, error } = await supabase
    .from("user_api_keys")
    .select("id, api_key, service, label")
    .eq("user_id", userId)
    .in("service", services)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  const out: { id: string; key: string; service: string; label: string }[] = [];
  for (const row of data || []) {
    try {
      out.push({
        id: row.id,
        key: await decryptStoredApiKey(row.api_key),
        service: row.service,
        label: row.label || "default",
      });
    } catch (e) {
      console.warn("[api-key-utils] decrypt failed for key", row.id, e);
    }
  }
  return out;
}