interface WelcomeBannerProps {
  companyName: string;
}

/** 按时段问候，比一句固定的 "Welcome back" 更像真人写的，不是模板感十足的欢迎语。 */
function timeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function WelcomeBanner({ companyName }: WelcomeBannerProps) {
  return (
    <div className="relative rounded-2xl overflow-hidden shadow-lg bg-gradient-to-r from-slate-900 via-slate-800 to-blue-900">
      <div className="relative px-8 py-12">
        <h1 className="text-4xl font-bold text-white mb-3">
          {timeOfDayGreeting()}, {companyName}.
        </h1>
      </div>
      <div className="absolute top-0 right-0 w-64 h-64 bg-sky-500/10 rounded-full blur-3xl" />
      <div className="absolute bottom-0 right-32 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl" />
    </div>
  );
}
