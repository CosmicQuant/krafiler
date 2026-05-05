fetch('http://localhost:3001/api/tax/file-return', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        kraPin: 'A014363966Z',
        kraPassword: '109466530',
        taxObligationType: 'turnover_tax',
        isNil: true,
        periodFrom: '2024-01-01',
        periodTo: '2024-01-31',
        totYear: 2024,
        totMonth: 1,
        ownsRentalProperty: false
    })
}).then(r => r.json()).then(console.log).catch(console.error);
