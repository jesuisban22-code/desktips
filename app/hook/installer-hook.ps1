# Enregistre (ou retire) le declencheur Bureau dans les reglages de Claude Code.
#
# Pourquoi ce fichier existe : la transcription dit tout ce que fait Claude
# Code, sauf une chose - le moment ou il ATTEND. Une demande d'autorisation ou
# une question restent a l'ecran sans rien ecrire sur le disque tant que tu
# n'as pas repondu. Seul un declencheur voit ce moment-la.
#
#   powershell -ExecutionPolicy Bypass -File installer-hook.ps1 -Exe "C:\...\bureau-hook.exe"
#   powershell -ExecutionPolicy Bypass -File installer-hook.ps1 -Remove
#
# -Settings permet de viser un autre fichier que ~/.claude/settings.json
# (c'est ce que font les essais, pour ne jamais toucher aux vrais reglages).

param(
    [string]$Exe,
    [switch]$Remove,
    [string]$Settings
)

$ErrorActionPreference = 'Stop'

if ($Settings) {
    $path = $Settings
    $dir  = Split-Path -Parent $path
} else {
    $dir  = Join-Path $env:USERPROFILE '.claude'
    $path = Join-Path $dir 'settings.json'
}

if (-not $Remove) {
    if (-not $Exe)            { Write-Host "  [X] Chemin de bureau-hook.exe manquant."; exit 1 }
    if (-not (Test-Path $Exe)) { Write-Host "  [X] Introuvable : $Exe"; exit 1 }
    $Exe = (Resolve-Path $Exe).Path
}

New-Item -ItemType Directory -Force -Path $dir | Out-Null

# Les reglages existants sont ceux de l'utilisateur : on les garde, et on en
# fait une copie avant d'y toucher.
$cfg = $null
if (Test-Path $path) {
    Copy-Item $path "$path.avant-bureau" -Force
    try {
        $cfg = Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        Write-Host "  [X] $path n'est pas un JSON valide. Je n'y touche pas."
        Write-Host "      Corrige-le, ou supprime-le si tu n'y tiens pas."
        exit 1
    }
}
if ($null -eq $cfg) { $cfg = New-Object PSObject }

function Ensure-Property($obj, $name, $value) {
    if ($null -eq $obj.PSObject.Properties[$name]) {
        $obj | Add-Member -NotePropertyName $name -NotePropertyValue $value
    }
    return $obj.$name
}

$hooks = Ensure-Property $cfg 'hooks' (New-Object PSObject)

# PreToolUse / PostToolUse : la premiere version s'y inscrivait. La
# transcription donne deja chaque appel d'outil, et l'inscription etait cassee
# de toute facon (voir plus bas) : on se contente de l'enlever.
# SessionStart : ouvre Bureau en widget au debut d'une session, s'il ne tourne
# pas deja (desactivable depuis le menu de son icone).
$wanted  = @('PermissionRequest', 'Notification', 'SessionStart')
$cleaned = @('PreToolUse', 'PostToolUse') + $wanted

foreach ($event in $cleaned) {
    $existing = @()
    if ($null -ne $hooks.PSObject.Properties[$event]) {
        $existing = @($hooks.$event)
    }

    # Retirer toute entree Bureau deja presente, pour que reinstaller
    # n'empile pas les doublons.
    $kept = @()
    foreach ($entry in $existing) {
        $isBureau = $false
        if ($null -ne $entry -and $null -ne $entry.PSObject.Properties['hooks']) {
            foreach ($h in @($entry.hooks)) {
                if ($null -ne $h.PSObject.Properties['command'] -and
                    "$($h.command)" -like '*bureau-hook*') { $isBureau = $true }
            }
        }
        if (-not $isBureau) { $kept += $entry }
    }

    if (-not $Remove -and $wanted -contains $event) {
        # "args" (meme vide) fait lancer l'exe DIRECTEMENT, sans shell. Sans
        # lui, Claude Code passe la commande a Git Bash, qui lit C:\Users\...
        # comme des echappements, obtient C:Users... et echoue a chaque appel :
        # c'est exactement ce qui est arrive a la premiere version.
        # "async" : Claude Code n'attend jamais Bureau.
        $cmd   = New-Object PSObject
        $cmd | Add-Member -NotePropertyName 'type'    -NotePropertyValue 'command'
        $cmd | Add-Member -NotePropertyName 'command' -NotePropertyValue $Exe
        $cmd | Add-Member -NotePropertyName 'args'    -NotePropertyValue @()
        $cmd | Add-Member -NotePropertyName 'async'   -NotePropertyValue $true

        $entry = New-Object PSObject
        $entry | Add-Member -NotePropertyName 'matcher' -NotePropertyValue '*'
        $entry | Add-Member -NotePropertyName 'hooks'   -NotePropertyValue @($cmd)

        $kept += $entry
    }

    if ($kept.Count -eq 0) {
        # Une liste vide laissee derriere soi, c'est du bruit dans les
        # reglages de quelqu'un d'autre.
        if ($null -ne $hooks.PSObject.Properties[$event]) {
            $hooks.PSObject.Properties.Remove($event)
        }
    } elseif ($null -eq $hooks.PSObject.Properties[$event]) {
        $hooks | Add-Member -NotePropertyName $event -NotePropertyValue @($kept)
    } else {
        $hooks.$event = @($kept)
    }
}

# Pas Set-Content -Encoding UTF8 : sous Windows PowerShell 5.1 il ecrit un BOM
# en tete du fichier, et un BOM devant un JSON le rend illisible pour beaucoup
# de parseurs. On ecrirait la config de quelqu'un et on la casserait.
$json = $cfg | ConvertTo-Json -Depth 20
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($path, $json, $utf8)

# La commande /desktips : un skill personnel, a cote des reglages. Le modele
# est un fichier UTF-8 a part (ce script, lui, doit rester en ASCII pour
# Windows PowerShell 5.1, qui lit les .ps1 sans BOM dans la page de code locale).
$skillDir = Join-Path (Join-Path $dir 'skills') 'desktips'
$skillMd  = Join-Path $skillDir 'SKILL.md'
if ($Remove) {
    # Seulement le notre : un skill "desktips" ecrit par quelqu'un d'autre reste.
    if ((Test-Path $skillMd) -and ((Get-Content $skillMd -Raw -Encoding UTF8) -like '*bureau-hook*')) {
        Remove-Item -Recurse -Force $skillDir
        Write-Host "  Commande /desktips retiree"
    }
} else {
    $template = Join-Path $PSScriptRoot 'desktips-SKILL.md'
    if (Test-Path $template) {
        New-Item -ItemType Directory -Force -Path $skillDir | Out-Null
        # Barres obliques : la commande du skill passe par bash, qui lirait
        # les barres inverses comme des echappements.
        $text = [System.IO.File]::ReadAllText($template, $utf8).Replace('{{EXE}}', $Exe.Replace('\', '/'))
        [System.IO.File]::WriteAllText($skillMd, $text, $utf8)
        Write-Host "  Commande /desktips installee : $skillMd"
    }
}

if ($Remove) {
    Write-Host "  Declencheur Bureau retire de $path"
} else {
    Write-Host "  Declencheur Bureau enregistre dans $path"
    Write-Host "  (autorisations, notifications, et ouverture au debut d'une session)"
    Write-Host "  Ouvre une NOUVELLE session Claude Code pour qu'il prenne effet."
}
if (Test-Path "$path.avant-bureau") {
    Write-Host "  Copie des reglages precedents : $path.avant-bureau"
}
