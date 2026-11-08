const RESEND_URL = "https://api.resend.com/emails";

interface CodeEmail {
  subject: string;
  /** The code sits on a line of its own, between these two. */
  intro: string;
  outro: string;
}

/**
 * The whole text lives here, not in the app: this endpoint must never be able
 * to send what a caller wrote. `{code}` is the login code.
 */
const EMAILS: Record<string, CodeEmail> = {
  ar: {
    subject: "رمز Snap2Link الخاص بك: {code}",
    intro: "رمز تسجيل الدخول إلى Snap2Link:",
    outro: "تنتهي صلاحية هذا الرمز خلال 10 دقائق. إذا لم تطلبه، فتجاهل هذه الرسالة.",
  },
  de: {
    subject: "Ihr Snap2Link-Code: {code}",
    intro: "Ihr Anmeldecode für Snap2Link:",
    outro: "Der Code läuft in 10 Minuten ab. Wenn Sie ihn nicht angefordert haben, ignorieren Sie diese E-Mail.",
  },
  en: {
    subject: "Your Snap2Link code: {code}",
    intro: "Your Snap2Link sign-in code:",
    outro: "It expires in 10 minutes. If you didn't ask for it, you can ignore this email.",
  },
  es: {
    subject: "Tu código de Snap2Link: {code}",
    intro: "Tu código para iniciar sesión en Snap2Link:",
    outro: "Caduca en 10 minutos. Si no lo has pedido, ignora este correo.",
  },
  fa: {
    subject: "کد Snap2Link شما: {code}",
    intro: "کد ورود شما به Snap2Link:",
    outro: "این کد تا ۱۰ دقیقه دیگر منقضی می‌شود. اگر آن را درخواست نکرده‌اید، این ایمیل را نادیده بگیرید.",
  },
  fr: {
    subject: "Votre code Snap2Link : {code}",
    intro: "Votre code de connexion à Snap2Link :",
    outro: "Il expire dans 10 minutes. Si vous ne l'avez pas demandé, ignorez cet e-mail.",
  },
  he: {
    subject: "קוד Snap2Link שלך: {code}",
    intro: "קוד הכניסה שלך ל-Snap2Link:",
    outro: "הקוד יפוג בעוד 10 דקות. אם לא ביקשת אותו, אפשר להתעלם מהודעה זו.",
  },
  hi: {
    subject: "आपका Snap2Link कोड: {code}",
    intro: "Snap2Link में साइन इन करने का आपका कोड:",
    outro: "यह 10 मिनट में समाप्त हो जाएगा। अगर आपने इसका अनुरोध नहीं किया, तो इस ईमेल को अनदेखा करें।",
  },
  id: {
    subject: "Kode Snap2Link Anda: {code}",
    intro: "Kode masuk Snap2Link Anda:",
    outro: "Kode ini berlaku selama 10 menit. Jika Anda tidak memintanya, abaikan email ini.",
  },
  it: {
    subject: "Il tuo codice Snap2Link: {code}",
    intro: "Il tuo codice di accesso a Snap2Link:",
    outro: "Scade tra 10 minuti. Se non l'hai richiesto, ignora questa email.",
  },
  ja: {
    subject: "Snap2Link のコード: {code}",
    intro: "Snap2Link のサインインコード:",
    outro: "このコードの有効期限は 10 分です。心当たりがない場合は、このメールを無視してください。",
  },
  ko: {
    subject: "Snap2Link 코드: {code}",
    intro: "Snap2Link 로그인 코드:",
    outro: "이 코드는 10분 후에 만료됩니다. 요청하지 않으셨다면 이 이메일을 무시하세요.",
  },
  pl: {
    subject: "Twój kod Snap2Link: {code}",
    intro: "Twój kod logowania do Snap2Link:",
    outro: "Wygaśnie za 10 minut. Jeśli to nie Ty o niego prosisz, zignoruj tę wiadomość.",
  },
  "pt-BR": {
    subject: "Seu código do Snap2Link: {code}",
    intro: "Seu código para entrar no Snap2Link:",
    outro: "Ele expira em 10 minutos. Se você não o solicitou, ignore este e-mail.",
  },
  ru: {
    subject: "Ваш код Snap2Link: {code}",
    intro: "Ваш код для входа в Snap2Link:",
    outro: "Он действует 10 минут. Если вы его не запрашивали, просто проигнорируйте это письмо.",
  },
  tr: {
    subject: "Snap2Link kodunuz: {code}",
    intro: "Snap2Link giriş kodunuz:",
    outro: "Bu kodun süresi 10 dakika içinde dolar. Bunu siz istemediyseniz bu e-postayı yok sayın.",
  },
  uk: {
    subject: "Ваш код Snap2Link: {code}",
    intro: "Ваш код для входу в Snap2Link:",
    outro: "Він діє 10 хвилин. Якщо ви його не запитували, просто проігноруйте цього листа.",
  },
  vi: {
    subject: "Mã Snap2Link của bạn: {code}",
    intro: "Mã đăng nhập Snap2Link của bạn:",
    outro: "Mã hết hạn sau 10 phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.",
  },
  "zh-CN": {
    subject: "你的 Snap2Link 验证码：{code}",
    intro: "你的 Snap2Link 登录验证码：",
    outro: "验证码将在 10 分钟后失效。如果这不是你本人的操作，请忽略此邮件。",
  },
  "zh-TW": {
    subject: "您的 Snap2Link 驗證碼：{code}",
    intro: "您的 Snap2Link 登入驗證碼：",
    outro: "驗證碼將在 10 分鐘後失效。如果這不是您本人的操作，請忽略此郵件。",
  },
};

/** True for a language the emails exist in, which are the app's. */
export const isLanguage = (language: unknown): language is string =>
  typeof language === "string" && Object.hasOwn(EMAILS, language);

/** The email in a language the relay knows, or in English. */
export function codeEmail(code: string, language: unknown): { subject: string; text: string } {
  const known = typeof language === "string" && Object.hasOwn(EMAILS, language);
  const email = known ? EMAILS[language] : EMAILS.en;
  return {
    subject: email.subject.replace("{code}", code),
    text: `${email.intro}\n\n${code}\n\n${email.outro}\n`,
  };
}

/** False when Resend didn't take the email, whatever the reason. */
export async function sendLoginCode(
  env: { RESEND_API_KEY: string; MAIL_FROM: string },
  to: string,
  code: string,
  language: unknown,
): Promise<boolean> {
  try {
    const answer = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: env.MAIL_FROM, to, ...codeEmail(code, language) }),
      signal: AbortSignal.timeout(10_000),
    });
    // The status only: the logs must never hold an address.
    if (!answer.ok) console.error(`resend refused an email: ${answer.status}`);
    return answer.ok;
  } catch {
    console.error("resend could not be reached");
    return false;
  }
}
