# Hướng Dẫn Deploy Ứng Dụng Giả Lập J2ME Web

Dự án đã được cấu hình sẵn sàng để deploy lên môi trường Production với đầy đủ tính năng:
- **Giao diện WebAssembly J2ME**: Chơi mượt mà mọi game Java (.jar).
- **Online WebSocket TCP Proxy**: Chơi được game online (Ninja School, Ngọc Rồng, Avatar...) thông qua TCP Tunnel.

---

## 🌟 Cách 1: Deploy lên Render.com (Khuyên dùng - Miễn phí 100% & Đầy đủ Online)

1. Đẩy mã nguồn lên tài khoản **GitHub** của bạn:
   ```bash
   git init
   git add .
   git commit -m "feat: j2me web emulator"
   git remote add origin https://github.com/Tên_Ban/Tên_Repo.git
   git push -u origin main
   ```
2. Truy cập [render.com](https://render.com/) -> Đăng nhập bằng GitHub.
3. Chọn **New +** -> **Web Service**.
4. Chọn repository GitHub vừa tạo.
5. Điền cấu hình:
   - **Environment**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
6. Bấm **Create Web Service**. Sau khoảng 1-2 phút, Render sẽ cấp cho bạn một đường link miễn phí dạng `https://ten-app.onrender.com`.

---

## 🚀 Cách 2: Deploy lên Railway.app (Cực nhanh & Ổn định)

1. Truy cập [railway.app](https://railway.app/) -> Đăng nhập bằng GitHub.
2. Chọn **New Project** -> **Deploy from GitHub repo**.
3. Chọn repo dự án của bạn. Railway sẽ tự động nhận diện `package.json`, chạy build và khởi chạy ứng dụng ngay lập tức!
4. Vào mục **Settings** -> **Generate Domain** để nhận đường link truy cập công khai.

---

## 🐳 Cách 3: Deploy trên VPS riêng (Docker hoặc PM2)

### Dùng Docker:
```bash
docker build -t j2me-web .
docker run -d -p 80:3000 --name j2me-web-app j2me-web
```

### Dùng PM2:
```bash
npm install
npm run build
npm install -g pm2
pm2 start server.js --name "j2me-web"
```

---

## ⚡ Cách 4: Deploy Web tĩnh (Vercel / Netlify / GitHub Pages)
Nếu bạn chỉ muốn deploy nhanh phần web tĩnh (hoặc dùng proxy bên ngoài):
1. Chạy lệnh build:
   ```bash
   npm run build
   ```
2. Thư mục sản phẩm là **`dist/`**. Bạn chỉ cần upload toàn bộ nội dung trong thư mục `dist/` lên Vercel, Netlify hoặc GitHub Pages.
