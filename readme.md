Lệnh MongoDB:

- Tìm kiếm: 
```javascript
db["items"].find({ "vietnamese": "máy bay" })
```

- Cập nhật:
```javascript
db.items.updateOne(
  { "_id": ObjectId("69d3b50427e715426aec824d") },
  { "$set": { "vietnamese": "sân bay" } }
)
```

- Xóa:
```javascript
db.items.deleteOne(
    { "_id": ObjectId("69d3b50427e715426aec824d") }
)
```