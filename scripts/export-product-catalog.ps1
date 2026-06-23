$ErrorActionPreference = "Stop"

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$skillScript = "C:\Users\Admin\.codex\skills\sapo-api\scripts\invoke-sapo-api.ps1"
$outputDir = Join-Path $workspaceRoot "data"
$outputPath = Join-Path $outputDir "product-catalog.json"

if (-not (Test-Path $skillScript)) {
  throw "Cannot find Sapo API helper at $skillScript"
}

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$allProducts = @()
$page = 1
$limit = 50

while ($true) {
  $path = "/admin/products.json?limit=$limit&page=$page"
  $response = powershell -NoProfile -ExecutionPolicy Bypass -File $skillScript -Path $path | ConvertFrom-Json
  $products = @($response.products)

  if ($products.Count -eq 0) {
    break
  }

  $allProducts += $products

  if ($products.Count -lt $limit) {
    break
  }

  $page += 1
}

$catalogItems = @()

foreach ($product in $allProducts) {
  $variants = @($product.variants)

  foreach ($variant in $variants) {
    $searchTerms = @(
      [string]$variant.sku,
      [string]$variant.barcode,
      [string]$product.name,
      [string]$variant.title,
      [string]$product.alias,
      [string]$product.tags
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

    $catalogItems += [pscustomobject]@{
      variant_id = $variant.id
      product_id = $product.id
      sku = [string]$variant.sku
      barcode = [string]$variant.barcode
      product_name = [string]$product.name
      variant_name = [string]$variant.title
      display_name = if (
        -not [string]::IsNullOrWhiteSpace([string]$variant.title) -and
        [string]$variant.title -ne "Default Title" -and
        [string]$variant.title -ne [string]$product.name
      ) {
        "{0} - {1}" -f [string]$product.name, [string]$variant.title
      } else {
        [string]$product.name
      }
      keywords = $searchTerms
      active = ([string]$product.status -eq "active")
    }
  }
}

$output = [pscustomobject]@{
  schema = "tq-product-catalog/v1"
  exported_at = (Get-Date).ToString("o")
  source = [pscustomobject]@{
    type = "sapo"
    store = "Thiên Quang Smarttools"
  }
  product_count = $allProducts.Count
  variant_count = $catalogItems.Count
  items = $catalogItems
}

$output | ConvertTo-Json -Depth 8 | Set-Content -Path $outputPath -Encoding UTF8

Write-Output ("Exported {0} products / {1} variants to {2}" -f $allProducts.Count, $catalogItems.Count, $outputPath)
