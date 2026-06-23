# Agen tạo đơn hàng

Mobile-first Sapo phone-order workflow and AI-assisted order creation agent for Thiên Quang Smarttools.

## Mục tiêu

Khi khách gọi điện trực tiếp, admin có thể mở dashboard trên điện thoại, nhập thông tin đơn thật nhanh, rồi gửi hàng chờ cho AI tạo đơn trên Sapo.

## Luồng MVP

1. Admin nhập SĐT khách.
2. Dashboard gợi ý khách cũ và địa chỉ cũ nếu có.
3. Admin chọn tỉnh/huyện/xã, nhập địa chỉ cụ thể.
4. Admin tìm sản phẩm theo SKU/tên, chọn nhiều sản phẩm và nhập số lượng.
5. Admin nhập tổng giá trị đơn hàng đã bao gồm phí ship.
6. Admin bấm Gửi AI tạo đơn.
7. Máy/AI xử lý queue, dry-run kiểm tra dữ liệu, rồi tạo đơn trên Sapo khi đủ điều kiện.

## Nguyên tắc an toàn

- Dashboard điện thoại không giữ token Sapo.
- Dữ liệu khách hàng và đơn hàng phải được mã hóa hoặc lưu trong inbox riêng.
- Mọi thao tác tạo đơn thật phải có dry-run và audit log.
- Nếu sản phẩm, địa chỉ hoặc tổng tiền chưa rõ, AI trả trạng thái cần bổ sung thay vì tạo đơn sai.

## Dữ liệu nền

- Product catalog: tên sản phẩm, SKU, variant_id, từ khóa search.
- Address catalog: tỉnh/huyện/xã và mã địa chỉ tương ứng.
- Customer index: SĐT, tên khách cũ, địa chỉ từng dùng, lần mua gần nhất.

## Trạng thái hàng chờ

- pending_ai: admin đã gửi yêu cầu tạo đơn.
- need_more_info: thiếu thông tin cần admin bổ sung.
- ready: đủ dữ liệu để tạo đơn.
- created: đã tạo đơn Sapo thành công.
- failed: tạo đơn lỗi, cần kiểm tra thủ công.
