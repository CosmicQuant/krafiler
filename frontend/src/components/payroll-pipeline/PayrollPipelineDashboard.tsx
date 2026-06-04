import { PayrollRunDetailPage } from './detail/PayrollRunDetailPage';
import type { ClientObligation } from '../../types';

interface PayrollPipelineDashboardProps {
    client: ClientObligation;
    onBack: () => void;
    initialTab?: string;
    initialRunId?: number;
}

export function PayrollPipelineDashboard({ client, onBack: _onBack }: PayrollPipelineDashboardProps) {
    return <PayrollRunDetailPage client={client} />;
}
