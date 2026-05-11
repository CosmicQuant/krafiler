import { ClientObligation } from '../../../types';
import { StatusBadge } from '../StatusBadges';

interface DeskElevyViewProps {
  clients: ClientObligation[];
  onOpenNewClientModal: (client?: ClientObligation) => void;
}

export function DeskElevyView({ clients, onOpenNewClientModal }: DeskElevyViewProps) {
  return (
    <div className="mt-10">
      <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/50 shadow-xl backdrop-blur">
        <div className="pb-16 sm:pb-32 overflow-x-auto lg:overflow-visible">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="border-b border-slate-800 bg-slate-900 rounded-t-2xl text-xs uppercase text-slate-400">
              <tr>
                <th className="px-2 py-3 sm:px-4 sm:py-4 font-semibold uppercase tracking-wider">Client Portfolio</th>
                <th className="px-2 py-3 sm:px-4 sm:py-4 font-semibold uppercase tracking-wider">Tourism Fund E-Levy</th>
                <th className="px-2 py-3 sm:px-4 sm:py-4 font-semibold text-right uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {clients.filter((c) => c.eLevy !== 'na').map((client) => (
                <tr key={client.id} className="transition hover:bg-slate-800/50">
                  <td className="whitespace-normal min-w-0 px-2 py-3 sm:px-4 sm:py-4">
                    <div
                      className="font-semibold text-emerald-400 hover:text-emerald-300 cursor-pointer"
                      onClick={() => onOpenNewClientModal(client)}
                      title="Edit client details"
                    >
                      {client.name}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{client.pin}</div>
                  </td>
                  <td className="whitespace-normal min-w-0 px-2 py-3 sm:px-4 sm:py-4">
                    <StatusBadge status={client.eLevy} />
                  </td>
                  <td className="whitespace-normal min-w-0 px-2 py-3 sm:px-4 sm:py-4 text-right">
                    <button className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700">
                      Actions
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
