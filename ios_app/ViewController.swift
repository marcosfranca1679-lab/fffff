//
//  5DAY MC - iOS App (WKWebView)
//  Desenvolvido em Swift com WKWebView nativo para iPhone/iPad
//  Suporte completo a:
//   1. Voltar abas e modais internamente antes de sair (handleAppBack / handleAndroidBack)
//   2. Permissão de fotos/arquivos (Tickets de Suporte, prints até 5MB)
//   3. Suporte a Swipe de Voltar nativo do iOS sincronizado com abas
//   4. Barra de navegação inferior / gestos de retorno
//

import UIKit
import WebKit
import Photos
import AVFoundation

class ViewController: UIViewController, WKUIDelegate, WKNavigationDelegate, UIGestureRecognizerDelegate {

    var webView: WKWebView!
    var activityIndicator: UIActivityIndicatorView!
    var backButton: UIButton!
    var lastBackPressTime: TimeInterval = 0

    override func loadView() {
        let webConfiguration = WKWebViewConfiguration()
        webConfiguration.allowsInlineMediaPlayback = true
        webConfiguration.mediaTypesRequiringUserActionForPlayback = []

        // Permissões de armazenamento / preferências web modernas
        let preferences = WKWebpagePreferences()
        preferences.allowsContentJavaScript = true
        webConfiguration.defaultWebpagePreferences = preferences

        // Custom User Agent para identificar o App iOS oficial
        let customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) 5DayMC-iOS/2.0 Mobile/15E148"
        webConfiguration.applicationNameForUserAgent = customUserAgent

        webView = WKWebView(frame: .zero, configuration: webConfiguration)
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.scrollView.bounces = false
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 11/255, green: 7/255, blue: 24/255, alpha: 1.0)
        
        // Habilita gesto nativo de arrastar da borda para voltar (Interactive Pop Gesture)
        webView.allowsBackForwardNavigationGestures = false // Desativado para dar controle total às abas do app

        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()

        pedirPermissoesDeArmazenamentoEFotos()
        setupUI()
        setupGestosDeVoltar()

        // Carregar URL do Servidor 5DAY MC
        if let url = URL(string: "https://fffff-autoforge.vercel.app") {
            let request = URLRequest(url: url)
            activityIndicator.startAnimating()
            webView.load(request)
        }
    }

    // Configuração dos controles visuais
    private func setupUI() {
        // Indicador de carregamento nativo com estilo Apple
        activityIndicator = UIActivityIndicatorView(style: .large)
        activityIndicator.color = UIColor.systemPurple
        activityIndicator.hidesWhenStopped = true
        activityIndicator.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(activityIndicator)

        // Botão flutuante de Voltar no iOS (útil caso o usuário queira voltar de abas facilmente)
        backButton = UIButton(type: .system)
        backButton.setTitle(" ‹ Voltar ", for: .normal)
        backButton.setTitleColor(.white, for: .normal)
        backButton.titleLabel?.font = UIFont.systemFont(ofSize: 12, weight: .bold)
        backButton.backgroundColor = UIColor(white: 0, alpha: 0.55)
        backButton.layer.cornerRadius = 14
        backButton.layer.borderWidth = 1
        backButton.layer.borderColor = UIColor(white: 1, alpha: 0.15).cgColor
        backButton.translatesAutoresizingMaskIntoConstraints = false
        backButton.addTarget(self, action: #selector(acaoVoltar), for: .touchUpInside)
        backButton.alpha = 0.85
        view.addSubview(backButton)

        NSLayoutConstraint.activate([
            activityIndicator.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            activityIndicator.centerYAnchor.constraint(equalTo: view.centerYAnchor),

            // Botão Voltar posicionado de forma sutil no topo esquerdo (respeitando safe area do notch/Dynamic Island)
            backButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 6),
            backButton.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 10),
            backButton.heightAnchor.constraint(equalToConstant: 28),
            backButton.widthAnchor.constraint(greaterThanOrEqualToConstant: 68)
        ])
    }

    // Configurar gesto de deslizar da borda esquerda para voltar aba
    private func setupGestosDeVoltar() {
        let edgeSwipe = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(handleEdgeSwipe(_:)))
        edgeSwipe.edges = .left
        edgeSwipe.delegate = self
        view.addGestureRecognizer(edgeSwipe)
    }

    @objc private func handleEdgeSwipe(_ gesture: UIScreenEdgePanGestureRecognizer) {
        if gesture.state == .recognized {
            acaoVoltar()
        }
    }

    // ── SISTEMA DE RETORNO INTELIGENTE (Não fecha o app, volta abas e fecha modais) ──
    @objc func acaoVoltar() {
        // Executa a mesma rotina inteligente do Android (fecha modais, visualização de tickets, submenus ou volta de aba)
        let js = "if (typeof window.handleAppBack === 'function') { window.handleAppBack(); } else if (typeof window.handleAndroidBack === 'function') { window.handleAndroidBack(); } else { 'root'; }"
        
        webView.evaluateJavaScript(js) { [weak self] (result, error) in
            guard let self = self else { return }
            
            let status = (result as? String) ?? ""
            if status == "handled" {
                // Ação tratada internamente pelo site (fechou modal, fechou ticket ou voltou de aba)
                let generator = UIImpactFeedbackGenerator(style: .light)
                generator.impactOccurred()
                return
            }

            // Se não foi tratado pelo site, verifica o histórico interno do WKWebView
            if self.webView.canGoBack {
                self.webView.goBack()
                return
            }

            // Se estiver na raiz/home do app, previne saída imediata
            let now = Date().timeIntervalSince1970
            if now - self.lastBackPressTime < 2.0 {
                // Toque duplo confirma saída
                exit(0)
            } else {
                self.lastBackPressTime = now
                self.mostrarToast("Toque novamente para sair do app")
            }
        }
    }

    // Solicitação antecipada de permissão de Fotos/Câmera para anexo de tickets
    private func pedirPermissoesDeArmazenamentoEFotos() {
        PHPhotoLibrary.requestAuthorization { status in
            switch status {
            case .authorized, .limited:
                print("✅ Permissão de fotos/arquivos concedida.")
            case .denied, .restricted:
                print("⚠️ Permissão de fotos negada.")
            case .notDetermined:
                break
            @unknown default:
                break
            }
        }
    }

    private func mostrarToast(_ mensagem: String) {
        let toastLabel = UILabel()
        toastLabel.text = mensagem
        toastLabel.textColor = .white
        toastLabel.font = UIFont.systemFont(ofSize: 13, weight: .semibold)
        toastLabel.textAlignment = .center
        toastLabel.backgroundColor = UIColor.black.withAlphaComponent(0.85)
        toastLabel.layer.cornerRadius = 18
        toastLabel.clipsToBounds = true
        toastLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(toastLabel)

        NSLayoutConstraint.activate([
            toastLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            toastLabel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -20),
            toastLabel.heightAnchor.constraint(equalToConstant: 36),
            toastLabel.widthAnchor.constraint(greaterThanOrEqualToConstant: 240)
        ])

        UIView.animate(withDuration: 0.3, delay: 1.8, options: .curveEaseOut, animations: {
            toastLabel.alpha = 0.0
        }) { _ in
            toastLabel.removeFromSuperview()
        }
    }

    // Status bar estilizada para combinar com o visual dark do 5DAY MC
    override var preferredStatusBarStyle: UIStatusBarStyle {
        return .lightContent
    }

    // MARK: - WKNavigationDelegate
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        activityIndicator.stopAnimating()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        activityIndicator.stopAnimating()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        activityIndicator.stopAnimating()

        let alert = UIAlertController(
            title: "Erro de Conexão",
            message: "Não foi possível conectar ao servidor do 5DAY MC. Verifique sua conexão com a internet.",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "Tentar Novamente", style: .default, handler: { _ in
            if let url = URL(string: "https://fffff-autoforge.vercel.app") {
                self.activityIndicator.startAnimating()
                self.webView.load(URLRequest(url: url))
            }
        }))
        present(alert, animated: true, completion: nil)
    }

    // Links externos abrem no Safari (Mercado Pago, GitHub, Downloads)
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }

        if url.host?.contains("fffff-autoforge.vercel.app") == true || url.host?.contains("supabase.co") == true {
            decisionHandler(.allow)
            return
        }

        if navigationAction.navigationType == .linkActivated {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }

        decisionHandler(.allow)
    }
}
