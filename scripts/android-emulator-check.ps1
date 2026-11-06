# ZhiCuo Android emulator smoke check (ASCII-only so Windows PowerShell 5.1 parses it).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/android-emulator-check.ps1 [-Apk <path>] [-Headless]
# Requires: JDK 17, Android SDK, system-images;android-35;default;x86_64, emulator, AEHD/WHPX.

param(
    [string]$Apk = "D:\AI\cuotiben\dist\zhicuo-android-0.4.0-debug.apk",
    [string]$AvdName = "zhicuo_test",
    [switch]$Headless
)

$ErrorActionPreference = "Stop"
$sdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
if (-not $env:JAVA_HOME -or -not (Test-Path $env:JAVA_HOME)) {
    $candidates = @(
        "C:\Program Files\Microsoft\jdk-17.0.21.21-hotspot",
        "C:\Program Files\Java\jdk-17",
        "C:\Program Files\Android\Android Studio\jbr"
    )
    foreach ($c in $candidates) { if (Test-Path $c) { $env:JAVA_HOME = $c; break } }
}
$adb = Join-Path $sdk "platform-tools\adb.exe"
$emulator = Join-Path $sdk "emulator\emulator.exe"
$avdmanager = Join-Path $sdk "cmdline-tools\latest\bin\avdmanager.bat"
$outDir = "D:\AI\cuotiben\dist\android-check"
$image = "system-images;android-35;default;x86_64"

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

if (-not (Test-Path $adb)) { throw "adb not found: $adb" }
if (-not (Test-Path $Apk)) { throw "APK not found: $Apk" }

# 1. Create or reuse AVD
$existing = & $avdmanager list avd 2>$null | Out-String
if ($existing -notmatch [regex]::Escape($AvdName)) {
    Write-Host "[1/6] create AVD $AvdName"
    "no" | & $avdmanager create avd -n $AvdName -k $image -d "pixel_5" --force
} else {
    Write-Host "[1/6] reuse AVD $AvdName"
}

# 2. Start emulator
Write-Host "[2/6] start emulator"
$emuArgs = @("-avd", $AvdName, "-no-snapshot", "-no-audio", "-no-boot-anim", "-gpu", "swiftshader_indirect")
if ($Headless) { $emuArgs += @("-no-window") }
$emu = Start-Process -FilePath $emulator -ArgumentList $emuArgs -PassThru
Start-Sleep -Seconds 3

# 3. Wait for boot
Write-Host "[3/6] wait for adb + boot"
$online = $false
for ($i = 0; $i -lt 90; $i++) {
    $devices = & $adb devices 2>$null | Out-String
    if ($devices -match "emulator-\d+\s+device") { $online = $true; break }
    Start-Sleep -Seconds 2
}
if (-not $online) { throw "adb did not see the emulator within 3 minutes" }
$booted = $false
for ($i = 0; $i -lt 180; $i++) {
    $state = (& $adb shell getprop sys.boot_completed 2>$null | Out-String).Trim()
    if ($state -eq "1") { $booted = $true; break }
    Start-Sleep -Seconds 2
}
if (-not $booted) { throw "emulator did not finish booting in 6 minutes" }
& $adb shell settings put global window_animation_scale 0 | Out-Null
& $adb shell settings put global transition_animation_scale 0 | Out-Null
& $adb shell settings put global animator_duration_scale 0 | Out-Null

# 4. Install APK
Write-Host "[4/6] install APK"
& $adb install -r $Apk
if ($LASTEXITCODE -ne 0) { throw "APK install failed" }

# 5. Launch app, capture screenshot and UI dump
Write-Host "[5/6] launch app"
& $adb shell am force-stop com.zhicuo.app
& $adb shell am start -n com.zhicuo.app/.MainActivity | Out-Null
Start-Sleep -Seconds 6
& $adb shell screencap -p /sdcard/01-home.png | Out-Null
& $adb pull /sdcard/01-home.png (Join-Path $outDir "01-home.png") | Out-Null
& $adb shell uiautomator dump /sdcard/ui.xml | Out-Null
& $adb pull /sdcard/ui.xml (Join-Path $outDir "01-home.xml") | Out-Null
$crash = & $adb logcat -d -b crash 2>$null | Out-String
$crash | Set-Content (Join-Path $outDir "logcat-crash.txt") -Encoding UTF8

# 6. Summarize (match Chinese strings by unicode code points to keep this file ASCII)
$uiText = if (Test-Path (Join-Path $outDir "01-home.xml")) { Get-Content (Join-Path $outDir "01-home.xml") -Raw } else { "" }
$homeTitle = [string][char]0x628A + [string][char]0x9519 + [string][char]0x9898   # 把错题
$navBook = [string][char]0x9519 + [string][char]0x9898 + [string][char]0x672C     # 错题本
$navPractice = [string][char]0x7EC3 + [string][char]0x4E60                        # 练习
$checks = [ordered]@{
    "home_title"   = $uiText -match [regex]::Escape($homeTitle)
    "bottom_nav"   = ($uiText -match [regex]::Escape($navBook)) -and ($uiText -match [regex]::Escape($navPractice))
    "no_crash"     = ($crash -notmatch "FATAL EXCEPTION")
}
$failed = @()
foreach ($key in $checks.Keys) {
    if ($checks[$key]) { Write-Host ("{0}: PASS" -f $key) } else { Write-Host ("{0}: FAIL" -f $key); $failed += $key }
}
Write-Host "screenshot + ui dump: $outDir"
Write-Host "stop emulator: adb emu kill"
if ($failed.Count -gt 0) { exit 1 }
