const fs = require('fs');
let content = fs.readFileSync('frontend/src/components/PracticeDashboard.tsx', 'utf8');

const target = \<td className="px-6 py-4">
                                                              <div className="flex gap-2">
                                                                  <input
                                                                      type="date"
                                                                      value={sel.periodFrom}\;

const replacement = \<td className="px-6 py-4">
                                                              <div className="flex flex-col gap-2">
                                                                  <div className="flex gap-2">
                                                                      <input
                                                                          type="date"
                                                                          value={sel.periodFrom}\;

const targetEnd = \                                                                  />
                                                              </div>
                                                          </td>
                                                          <td className="px-6 py-4 text-right">\;

const replacementEnd = \                                                                  />
                                                                  </div>
                                                                  {(sel.type === 'income_tax_resident_individual' || sel.type === 'income_tax_non_resident_individual') && (
                                                                      <label className="flex items-center gap-2 mt-1 cursor-pointer w-max">
                                                                          <input 
                                                                              type="checkbox"
                                                                              checked={sel.ownsRentalProperty || false}
                                                                              onChange={(e) => setNilSelections(prev => ({ ...prev, [client.id]: { ...sel, ownsRentalProperty: e.target.checked } }))}
                                                                              className="rounded bg-slate-800 border-slate-700 focus:ring-amber-500 accent-amber-500 h-3.5 w-3.5"
                                                                          />
                                                                          <span className="text-[11px] text-slate-400">Owns Rental Property?</span>
                                                                      </label>
                                                                  )}
                                                              </div>
                                                          </td>
                                                          <td className="px-6 py-4 text-right">\;

content = content.replace(target, replacement);
content = content.replace(targetEnd, replacementEnd);
fs.writeFileSync('frontend/src/components/PracticeDashboard.tsx', content);
