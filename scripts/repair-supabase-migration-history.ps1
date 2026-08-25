param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRef
)

# Marks the pre-existing migrations as applied in the specified Supabase project.
# Run only after verifying that this is the migrated production project. It does
# not execute the SQL files or modify application data.
$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationDirectory = Join-Path $repoRoot "supabase\migrations"
$baselineVersion = "20260825040000"

$versions = Get-ChildItem -LiteralPath $migrationDirectory -Filter "*.sql" |
  ForEach-Object { ($_.BaseName -split "_", 2)[0] } |
  Where-Object { $_ -lt $baselineVersion } |
  Sort-Object -Unique

if (-not $versions) {
  throw "No existing migration versions were found."
}

Write-Host "Marking $($versions.Count) existing migrations as applied for $ProjectRef."
npx --yes supabase@latest migration repair --project-ref $ProjectRef --status applied @versions
