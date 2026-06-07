# Genere les icones de l'extension (16/48/128) — design aphrody : fond rose
# #984061, barres d'egaliseur blanches (symbole son / TTS). Reproductible.
Add-Type -AssemblyName System.Drawing

function Get-RoundedRect([System.Drawing.RectangleF]$r, [single]$radius) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $radius * 2
  $p.AddArc($r.X, $r.Y, $d, $d, 180, 90)
  $p.AddArc($r.Right - $d, $r.Y, $d, $d, 270, 90)
  $p.AddArc($r.Right - $d, $r.Bottom - $d, $d, $d, 0, 90)
  $p.AddArc($r.X, $r.Bottom - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function New-Icon([int]$size, [string]$path) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  # fond arrondi #984061
  $bg = [System.Drawing.Color]::FromArgb(255, 152, 64, 97)
  $bgBrush = New-Object System.Drawing.SolidBrush($bg)
  $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
  $radius = [single]($size * 0.22)
  $bgPath = Get-RoundedRect $rect $radius
  $g.FillPath($bgBrush, $bgPath)

  # 3 barres d'egaliseur blanches
  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $barW = [single]($size * 0.15)
  $gap = [single]($size * 0.10)
  $totalW = $barW * 3 + $gap * 2
  $startX = ($size - $totalW) / 2
  $cy = $size / 2.0
  $heights = @(0.42, 0.66, 0.50) # proportion de la hauteur
  for ($i = 0; $i -lt 3; $i++) {
    $h = [single]($size * $heights[$i])
    $x = $startX + $i * ($barW + $gap)
    $y = $cy - $h / 2
    $barRect = New-Object System.Drawing.RectangleF($x, $y, $barW, $h)
    $barRadius = [single]([Math]::Min($barW / 2, 3))
    $barPath = Get-RoundedRect $barRect $barRadius
    $g.FillPath($white, $barPath)
  }

  $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "ecrit: $path ($size x $size)"
}

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
foreach ($s in 16, 48, 128) {
  New-Icon $s (Join-Path $dir "icon-$s.png")
}
