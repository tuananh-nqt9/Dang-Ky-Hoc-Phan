export type RegistrationStatus = 'ACTIVE' | 'CANCELLED';
export type RegistrationPaymentStatus = 'UNPAID' | 'PAID' | 'REFUNDED';
export type PaymentStatus = 'PAID' | 'REFUNDED';
export type PaymentStatusFilter = PaymentStatus | 'ALL';

export interface StudentRegistration {
  registration_id: string;
  student_id: string;
  course_class_id: string;
  class_code: string;
  course_name: string;
  credits: number;
  status: RegistrationStatus;
  payment_status: RegistrationPaymentStatus;
  tuition_amount: number;
  registered_at: string;
  cancelled_at?: string | null;
}

export interface PaymentRecord {
  payment_id: string;
  registration_id: string;
  course_class_id: string;
  class_code: string;
  amount: number;
  currency?: 'VND';
  status: PaymentStatus;
  paid_at: string;
  refunded_at?: string | null;
}

export interface TuitionSummary {
  registrationCount: number;
  totalCredits: number;
  totalTuition: number;
  amountPaid: number;
  amountDue: number;
  averageCreditPrice: number | null;
}

export function summarizeTuition(registrations: StudentRegistration[]): TuitionSummary {
  const activeRegistrations = registrations.filter((registration) => registration.status === 'ACTIVE');
  const totalCredits = activeRegistrations.reduce((total, registration) => total + registration.credits, 0);
  const totalTuition = activeRegistrations.reduce((total, registration) => total + registration.tuition_amount, 0);
  const amountPaid = activeRegistrations
    .filter((registration) => registration.payment_status === 'PAID')
    .reduce((total, registration) => total + registration.tuition_amount, 0);
  const amountDue = activeRegistrations
    .filter((registration) => registration.payment_status === 'UNPAID')
    .reduce((total, registration) => total + registration.tuition_amount, 0);

  return {
    registrationCount: activeRegistrations.length,
    totalCredits,
    totalTuition,
    amountPaid,
    amountDue,
    averageCreditPrice: totalCredits > 0 ? totalTuition / totalCredits : null,
  };
}
