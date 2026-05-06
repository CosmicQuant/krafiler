param(
    [Parameter(Mandatory = $true)] [string]$WorkbookPath,
    [Parameter(Mandatory = $true)] [string]$CsvDirectory,
    [Parameter(Mandatory = $true)] [string]$GeneratedDirectory,
    [Parameter(Mandatory = $true)] [string]$TaxpayerPin,
    [Parameter(Mandatory = $true)] [string]$PeriodFrom,
    [Parameter(Mandatory = $true)] [string]$PeriodTo,
    [Parameter(Mandatory = $true)] [string]$OutputJsonPath,
    [double]$PreviousCredit = 0
)

$ErrorActionPreference = 'Stop'

function Invoke-ComAction {
    param(
        [Parameter(Mandatory = $true)] [scriptblock]$Action,
        [int]$Attempts = 40
    )

    for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
        try {
            return & $Action
        } catch [System.Runtime.InteropServices.COMException] {
            $hresult = $_.Exception.HResult
            if ($hresult -in @(-2147418111, -2146777998) -and $attempt -lt ($Attempts - 1)) {
                continue
            }

            throw
        }
    }

    throw 'Excel COM action exhausted retries.'
}

function Convert-ToKraDate {
    param([Parameter(Mandatory = $true)] [string]$IsoDate)
    return ([DateTime]::Parse($IsoDate)).ToString('dd/MM/yyyy')
}

function Convert-ToInvariantNumberString {
    param([Parameter(Mandatory = $true)] [double]$Value)

    if ([Math]::Abs($Value - [Math]::Round($Value, 0)) -lt 0.0000001) {
        return ([Math]::Round($Value, 0)).ToString([System.Globalization.CultureInfo]::InvariantCulture)
    }

    return ([Math]::Round($Value, 4)).ToString([System.Globalization.CultureInfo]::InvariantCulture)
}

function Get-ParsedCsvRows {
    param([Parameter(Mandatory = $true)] [string]$FilePath)

    if (-not (Test-Path $FilePath)) {
        return @()
    }

    Add-Type -AssemblyName Microsoft.VisualBasic
    $parser = New-Object Microsoft.VisualBasic.FileIO.TextFieldParser($FilePath)
    $parser.TextFieldType = [Microsoft.VisualBasic.FileIO.FieldType]::Delimited
    $parser.SetDelimiters(',')
    $parser.HasFieldsEnclosedInQuotes = $true

    $rows = New-Object System.Collections.Generic.List[object]
    try {
        while (-not $parser.EndOfData) {
            $fields = $parser.ReadFields()
            if ($null -eq $fields) {
                continue
            }

            $rows.Add($fields)
        }
    } finally {
        $parser.Close()
    }

    return $rows
}

function Normalise-InvoiceNumber {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) {
        return ''
    }

    return ($Value -replace '^\|', '').Trim()
}

function Convert-ToVatAmount {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) {
        return 0.0
    }

    return [double]::Parse($Value, [System.Globalization.CultureInfo]::InvariantCulture)
}

function Get-TrimmedValue {
    param(
        $Row,
        [int]$Index
    )

    if ($null -eq $Row -or $Row.Length -le $Index -or $null -eq $Row[$Index]) {
        return ''
    }

    return ([string]$Row[$Index]).Trim()
}

function Get-WorkbookDefinedNameMap {
    param([Parameter(Mandatory = $true)] [string]$WorkbookPath)

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($WorkbookPath)
    try {
        $entry = $zip.Entries | Where-Object { $_.FullName -eq 'xl/workbook.xml' } | Select-Object -First 1
        if ($null -eq $entry) {
            throw 'Could not locate xl/workbook.xml in the VAT workbook.'
        }

        $reader = New-Object System.IO.StreamReader($entry.Open())
        try {
            [xml]$xml = $reader.ReadToEnd()
        } finally {
            $reader.Close()
        }
    } finally {
        $zip.Dispose()
    }

    $namespaceManager = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
    $namespaceManager.AddNamespace('x', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
    $nodes = $xml.SelectNodes('//x:definedName', $namespaceManager)

    $map = @{}
    foreach ($node in $nodes) {
        $name = Normalize-DefinedName ([string]$node.name)
        if ([string]::IsNullOrWhiteSpace($name) -or $name.StartsWith('_xlnm.')) {
            continue
        }

        $reference = ([string]$node.InnerText).Trim()
        if (-not [string]::IsNullOrWhiteSpace($reference)) {
            $map[$name] = $reference
        }
    }

    return $map
}

function Resolve-ReferenceParts {
    param([Parameter(Mandatory = $true)] [string]$Reference)

    $normalizedReference = $Reference.Trim()
    if ($normalizedReference.StartsWith('=')) {
        $normalizedReference = $normalizedReference.Substring(1)
    }

    $match = [regex]::Match($normalizedReference, '^''?([^'']+)''?!\$?([A-Z]+)\$?(\d+)$')
    if (-not $match.Success) {
        throw "Reference '$Reference' is not a single-cell worksheet address."
    }

    return @{
        SheetName = $match.Groups[1].Value
        Column = $match.Groups[2].Value
        Row = [int]$match.Groups[3].Value
    }
}

function Map-SalesRows {
    param([object[]]$Rows)

    $mappedRows = New-Object System.Collections.Generic.List[object]
    foreach ($row in $Rows) {
        if ($row.Length -lt 7) {
            continue
        }

        $salesAmount = Convert-ToVatAmount $row[6]
        $vatAmount = $salesAmount * 0.16

        $mappedRows.Add(@(
            (Get-TrimmedValue $row 0),
            (Get-TrimmedValue $row 1),
            (Get-TrimmedValue $row 2),
            (Get-TrimmedValue $row 3),
            (Normalise-InvoiceNumber $row[4]),
            (Get-TrimmedValue $row 5),
            $salesAmount,
            $vatAmount,
            $(if ($row.Length -gt 7) { Get-TrimmedValue $row 7 } else { '' }),
            $(if ($row.Length -gt 8) { Get-TrimmedValue $row 8 } else { '' }),
            'GNRL'
        ))
    }

    return $mappedRows
}

function Map-PurchaseRows {
    param(
        [object[]]$Rows,
        [string]$RateCode
    )

    $mappedRows = New-Object System.Collections.Generic.List[object]
    foreach ($row in $Rows) {
        if ($row.Length -lt 8) {
            continue
        }

        $purchaseAmount = Convert-ToVatAmount $row[7]
        $vatAmount = $purchaseAmount * 0.16

        $mappedRows.Add(@(
            (Get-TrimmedValue $row 0),
            (Get-TrimmedValue $row 1),
            (Get-TrimmedValue $row 2),
            (Get-TrimmedValue $row 3),
            (Normalise-InvoiceNumber $row[4]),
            (Get-TrimmedValue $row 5),
            $(if ($row.Length -gt 6) { Get-TrimmedValue $row 6 } else { '' }),
            $purchaseAmount,
            $vatAmount,
            $(if ($row.Length -gt 8) { Get-TrimmedValue $row 8 } else { '' }),
            $(if ($row.Length -gt 9) { Get-TrimmedValue $row 9 } else { '' }),
            (Get-TrimmedValue $row 0),
            $RateCode
        ))
    }

    return $mappedRows
}

function Clear-WorksheetRows {
    param(
        $Worksheet,
        [int]$StartRow,
        [string]$EndColumn,
        [int]$MaxRows = 12000
    )

    Invoke-ComAction { $Worksheet.Range("A${StartRow}:${EndColumn}${MaxRows}").ClearContents() | Out-Null }
}

function Write-WorksheetRows {
    param(
        $Worksheet,
        [int]$StartRow,
        [object[]]$Rows
    )

    if ($Rows.Count -eq 0) {
        return
    }

    $columnCount = $Rows[0].Length
    $array = New-Object 'object[,]' $Rows.Count, $columnCount

    for ($rowIndex = 0; $rowIndex -lt $Rows.Count; $rowIndex++) {
        for ($columnIndex = 0; $columnIndex -lt $columnCount; $columnIndex++) {
            $array[$rowIndex, $columnIndex] = $Rows[$rowIndex][$columnIndex]
        }
    }

    $target = Invoke-ComAction { $Worksheet.Cells.Item($StartRow, 1).Resize($Rows.Count, $columnCount) }
    Invoke-ComAction { $target.Value2 = $array }
}

function Normalize-DefinedName {
    param([Parameter(Mandatory = $true)] [string]$Name)

    $normalized = $Name.Trim()
    if ($normalized.StartsWith('=')) {
        $normalized = $normalized.Substring(1)
    }

    if ($normalized.Contains('!')) {
        $normalized = $normalized.Split('!')[-1]
    }

    return $normalized.Trim("'")
}

function Set-NamedValue {
    param(
        $Workbook,
        [Parameter(Mandatory = $true)] [string]$Name,
        $Value
    )

    if (-not $script:DefinedNameMap.ContainsKey($Name)) {
        throw "Workbook named range '$Name' was not found in workbook.xml."
    }

    $referenceParts = Resolve-ReferenceParts $script:DefinedNameMap[$Name]
    $worksheet = Get-WorksheetByName $Workbook $referenceParts.SheetName
    $cell = Invoke-ComAction { $worksheet.Range("$($referenceParts.Column)$($referenceParts.Row)") }
    Invoke-ComAction { $cell.Value2 = $Value }
}

function Get-SingleCellNamedValues {
    param($Workbook)

    $result = @{}
    foreach ($definedName in $script:DefinedNameMap.GetEnumerator()) {
        try {
            $reference = [string]$definedName.Value
            if ($reference.Contains(':') -or $reference.Contains(',')) {
                continue
            }

            $referenceParts = Resolve-ReferenceParts $reference
            $worksheet = Get-WorksheetByName $Workbook $referenceParts.SheetName
            $cell = Invoke-ComAction { $worksheet.Range("$($referenceParts.Column)$($referenceParts.Row)") }
            $name = [string]$definedName.Key
            $value = Invoke-ComAction { $cell.Text }
            if ($null -eq $value) {
                $value = ''
            }
            $result[$name] = [string]$value
        } catch {
            continue
        }
    }

    return $result
}

function Get-WorksheetByName {
    param(
        $Workbook,
        [Parameter(Mandatory = $true)] [string]$SheetName
    )

    return Invoke-ComAction { $Workbook.Worksheets.Item($SheetName) }
}

function Try-RunAutoPopulation {
    param(
        $Excel,
        $Workbook
    )

    $candidateMacros = @(
        "'$($Workbook.Name)'!AutoPopulation",
        "'$($Workbook.Name)'!Module1.AutoPopulation",
        "'$($Workbook.Name)'!Module2.AutoPopulation",
        "'$($Workbook.Name)'!Module3.AutoPopulation"
    )

    foreach ($macroName in $candidateMacros) {
        try {
            Invoke-ComAction { $Excel.Run($macroName) | Out-Null }
            return $true
        } catch {
            continue
        }
    }

    return $false
}

function Get-NonEmptyWorksheetRows {
    param(
        $Worksheet,
        [int]$StartRow,
        [int]$EndColumnIndex
    )

    $usedRange = Invoke-ComAction { $Worksheet.UsedRange }
    $usedRows = [int](Invoke-ComAction { $usedRange.Rows.Count })
    $usedStart = [int](Invoke-ComAction { $usedRange.Row })
    $lastRow = $usedStart + $usedRows - 1

    $rows = New-Object System.Collections.Generic.List[object]
    if ($lastRow -lt $StartRow) {
        return $rows
    }

    for ($row = $StartRow; $row -le $lastRow; $row++) {
        $values = New-Object System.Collections.Generic.List[string]
        $hasContent = $false
        for ($column = 1; $column -le $EndColumnIndex; $column++) {
            $cellText = [string](Invoke-ComAction { $Worksheet.Cells.Item($row, $column).Text })
            $trimmed = $cellText.Trim()
            if ($trimmed.Length -gt 0) {
                $hasContent = $true
            }
            $values.Add($trimmed)
        }

        if ($hasContent) {
            $rows.Add($values)
        }
    }

    return $rows
}

function Export-RowsToCsv {
    param(
        [Parameter(Mandatory = $true)] [object[]]$Rows,
        [Parameter(Mandatory = $true)] [string]$DestinationPath
    )

    if ($Rows.Count -eq 0) {
        return $false
    }

    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($row in $Rows) {
        $escapedColumns = foreach ($column in $row) {
            $raw = [string]$column
            if ($raw.Contains(',') -or $raw.Contains('"') -or $raw.Contains("`n") -or $raw.Contains("`r")) {
                '"' + ($raw -replace '"', '""') + '"'
            } else {
                $raw
            }
        }

        $lines.Add(($escapedColumns -join ','))
    }

    Set-Content -Path $DestinationPath -Value $lines -Encoding UTF8
    return $true
}

function Get-ColumnIndexFromLetter {
    param([Parameter(Mandatory = $true)] [string]$ColumnLetter)

    $sum = 0
    foreach ($character in $ColumnLetter.ToUpper().ToCharArray()) {
        $sum = ($sum * 26) + ([int][char]$character - [int][char]'A' + 1)
    }
    return $sum
}

if (-not (Test-Path $GeneratedDirectory)) {
    New-Item -ItemType Directory -Path $GeneratedDirectory | Out-Null
}

$script:DefinedNameMap = Get-WorkbookDefinedNameMap $WorkbookPath

$excel = $null
$workbook = $null

try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.ScreenUpdating = $false
    $excel.EnableEvents = $false
    $excel.AutomationSecurity = 1

    $workbook = Invoke-ComAction { $excel.Workbooks.Open($WorkbookPath, 0, $false) }

    Set-NamedValue $workbook 'SecA.TaxPayerPIN' $TaxpayerPin.ToUpperInvariant()
    Set-NamedValue $workbook 'SecA.RtnPdFrom' (Convert-ToKraDate $PeriodFrom)
    Set-NamedValue $workbook 'SecA.RtnPdTo' (Convert-ToKraDate $PeriodTo)
    Set-NamedValue $workbook 'SecA.RtnPrdToActStart' (Convert-ToKraDate $PeriodFrom)
    Set-NamedValue $workbook 'SecA.RtnPrdToAct' (Convert-ToKraDate $PeriodTo)
    Set-NamedValue $workbook 'SecA.RtnYear' ([DateTime]::Parse($PeriodTo)).Year
    Set-NamedValue $workbook 'SecA.MonthCode' ([DateTime]::Parse($PeriodTo)).ToString('MM')
    Set-NamedValue $workbook 'SecA.RtnType' 'Original'
    Set-NamedValue $workbook 'SecA.EntityType' 'Head Office'
    Set-NamedValue $workbook 'SecA.EntityTypeCode' 'HOET'
    Set-NamedValue $workbook 'SecA.VatNonResident' 'No'
    Set-NamedValue $workbook 'SecD.CrdtBroughtFrwd' $PreviousCredit

    $autoPopulationSucceeded = Try-RunAutoPopulation $excel $workbook

    if (-not $autoPopulationSucceeded) {
        $sheetB = Get-WorksheetByName $workbook 'B_General_Rated_Sales_Dtls'
        $sheetF = Get-WorksheetByName $workbook 'F_General_Rated_Purchases_Dtls'
        $sheetG = Get-WorksheetByName $workbook 'G_Other_Rated_Purchases_Dtls'

        Clear-WorksheetRows $sheetB 3 'K'
        Clear-WorksheetRows $sheetF 3 'M'
        Clear-WorksheetRows $sheetG 3 'M'

        $salesRows = New-Object System.Collections.Generic.List[object]
        foreach ($candidate in @('SEC_B_WITH_VAT_PIN1.CSV', 'SEC_B_WITHOUT_PIN_AND_NON-VAT_PIN1.CSV')) {
            $rows = Get-ParsedCsvRows (Join-Path $CsvDirectory $candidate)
            foreach ($mappedRow in (Map-SalesRows $rows)) {
                $salesRows.Add($mappedRow)
            }
        }

        $generalPurchaseRows = Map-PurchaseRows (Get-ParsedCsvRows (Join-Path $CsvDirectory 'SEC_F_WITH_VAT_PIN1.CSV')) 'GNRL'
        $otherPurchaseRows = Map-PurchaseRows (Get-ParsedCsvRows (Join-Path $CsvDirectory 'SEC_G_WITH_VAT_PIN1.CSV')) 'OTHR'

        Write-WorksheetRows $sheetB 3 $salesRows
        Write-WorksheetRows $sheetF 3 $generalPurchaseRows
        Write-WorksheetRows $sheetG 3 $otherPurchaseRows
    }

    Invoke-ComAction { $workbook.Application.CalculateFullRebuild() | Out-Null }
    Invoke-ComAction { $workbook.Save() | Out-Null }

    $singleCellValues = Get-SingleCellNamedValues $workbook

    $exports = @(
        @{ SheetName = 'B_General_Rated_Sales_Dtls'; FileName = 'B_General_Rated_Sales_Dtls.csv'; StartRow = 3; EndColumn = 'K' },
        @{ SheetName = 'C_Other_Rated_Sales_Dtls'; FileName = 'C_Other_Rated_Sales_Dtls.csv'; StartRow = 3; EndColumn = 'K' },
        @{ SheetName = 'D_Zero_Rated_Sales_Dtls'; FileName = 'D_Zero_Rated_Sales_Dtls.csv'; StartRow = 3; EndColumn = 'L' },
        @{ SheetName = 'E_Exempted_Sales_Dtls'; FileName = 'E_Exempted_Sales_Dtls.csv'; StartRow = 3; EndColumn = 'H' },
        @{ SheetName = 'F_General_Rated_Purchases_Dtls'; FileName = 'F_General_Rated_Purchases_Dtls.csv'; StartRow = 3; EndColumn = 'M' },
        @{ SheetName = 'G_Other_Rated_Purchases_Dtls'; FileName = 'G_Other_Rated_Purchases_Dtls.csv'; StartRow = 3; EndColumn = 'M' },
        @{ SheetName = 'H_Zero_Rated_Purchases_Dtls'; FileName = 'H_Zero_Rated_Purchases_Dtls.csv'; StartRow = 3; EndColumn = 'K' },
        @{ SheetName = 'I_Exempted_Purchases_Dtls'; FileName = 'I_Exempted_Purchases_Dtls.csv'; StartRow = 3; EndColumn = 'J' },
        @{ SheetName = 'J_VAT_Imported_Services_Dtls'; FileName = 'J_VAT_Imported_Services_Dtls.csv'; StartRow = 3; EndColumn = 'H' },
        @{ SheetName = 'L_WHT_Credits'; FileName = 'L_WHT_Credits.csv'; StartRow = 3; EndColumn = 'E' }
    )

    $generatedFiles = New-Object System.Collections.Generic.List[string]
    foreach ($export in $exports) {
        $sheet = Get-WorksheetByName $workbook $export.SheetName
        $rows = Get-NonEmptyWorksheetRows $sheet $export.StartRow (Get-ColumnIndexFromLetter $export.EndColumn)
        $destination = Join-Path $GeneratedDirectory $export.FileName
        if (Export-RowsToCsv $rows $destination) {
            $generatedFiles.Add($destination)
        }
    }

    $summary = @{
        inputVat = [double]($(if ($singleCellValues.ContainsKey('TaxDue.TotalVatPurCharged')) { $singleCellValues['TaxDue.TotalVatPurCharged'] } else { '0' }))
        outputVat = [double]($(if ($singleCellValues.ContainsKey('TaxDue.OutputTaxCharged')) { $singleCellValues['TaxDue.OutputTaxCharged'] } else { '0' }))
        previousCredit = [double]($(if ($singleCellValues.ContainsKey('SecD.CrdtBroughtFrwd')) { $singleCellValues['SecD.CrdtBroughtFrwd'] } else { '0' }))
        payableVat = [double]($(if ($singleCellValues.ContainsKey('SecD.FinalTaxPayable')) { $singleCellValues['SecD.FinalTaxPayable'] } else { '0' }))
        netVatBalance = [double]($(if ($singleCellValues.ContainsKey('SecD.NetTaxPayableClaimable')) { $singleCellValues['SecD.NetTaxPayableClaimable'] } else { '0' }))
    }

    $result = @{
        workbookPath = $WorkbookPath
        autoPopulationSucceeded = $autoPopulationSucceeded
        generatedFiles = $generatedFiles
        summary = $summary
        namedValues = $singleCellValues
    }

    $json = $result | ConvertTo-Json -Depth 6
    Set-Content -Path $OutputJsonPath -Value $json -Encoding UTF8
    Write-Output $json
} finally {
    try {
        if ($workbook) {
            $workbook.Close($false) | Out-Null
        }
    } catch {}

    try {
        if ($excel) {
            $excel.Quit()
        }
    } catch {}

    try {
        if ($workbook) {
            [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($workbook)
        }
    } catch {}

    try {
        if ($excel) {
            [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
        }
    } catch {}

    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}